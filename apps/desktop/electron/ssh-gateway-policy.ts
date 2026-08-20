import type { GatewayProxyPurpose } from './gateway-proxy'

const MAX_GATEWAY_FRAME_BYTES = 16 * 1024 * 1024
const MAX_PROMPT_CHARS = 1_000_000
const MAX_VOICE_FRAME_BYTES = 64 * 1024
const RESERVED_GATEWAY_PROFILES = new Set(['hermes', 'root', 'sudo', 'test', 'tmp'])

const FORBIDDEN_PARAM_KEY =
  /(?:__proto__|api[_-]?key|billing|constructor|credential|env|oauth|password|prototype|secret|subscription|token)/i

const SAFE_GATEWAY_METHODS = new Set([
  'approval.respond',
  'clarify.respond',
  'commands.catalog',
  'complete.path',
  'complete.slash',
  'llm.oneshot',
  'message.react',
  'model.options',
  'process.kill',
  'process.list',
  'profiles.get_asset',
  'session.activate',
  'session.active_list',
  'session.branch',
  'session.close',
  'session.compress',
  'session.context_breakdown',
  'session.create',
  'session.cwd.set',
  'session.interrupt',
  'session.redirect',
  'session.resume',
  'session.status',
  'session.title',
  'session.usage'
])

const SAFE_METHOD_PARAM_KEYS: Record<string, readonly string[]> = {
  'approval.respond': ['choice', 'request_id', 'session_id'],
  'clarify.respond': ['answer', 'request_id', 'session_id'],
  'commands.catalog': ['session_id'],
  'complete.path': ['cwd', 'session_id', 'word'],
  'complete.slash': ['session_id', 'text'],
  'llm.oneshot': ['input', 'instructions', 'max_tokens', 'session_id', 'task', 'temperature', 'template', 'variables'],
  'message.react': ['author', 'emoji', 'newest_role', 'row_id', 'session_id'],
  'model.options': ['explicit_only', 'refresh', 'session_id'],
  'process.kill': ['process_id', 'session_id'],
  'process.list': ['session_id'],
  'profiles.get_asset': ['asset', 'name'],
  'session.activate': ['cols', 'omit_messages', 'session_id'],
  'session.active_list': [],
  'session.branch': ['count', 'name', 'session_id'],
  'session.close': ['session_id'],
  'session.compress': ['focus_topic', 'session_id'],
  'session.context_breakdown': ['session_id'],
  'session.create': [
    'close_on_disconnect',
    'cols',
    'cwd',
    'fast',
    'messages',
    'model',
    'parent_session_id',
    'profile',
    'provider',
    'reasoning_effort',
    'source',
    'title'
  ],
  'session.cwd.set': ['cwd', 'session_id'],
  'session.interrupt': ['session_id'],
  'session.redirect': ['session_id', 'text'],
  'session.resume': ['cols', 'lazy', 'omit_messages', 'profile', 'session_id', 'source'],
  'session.status': ['session_id'],
  'session.title': ['session_id', 'title'],
  'session.usage': ['session_id']
}

function denied(): never {
  throw new Error('This gateway operation is unavailable in the SSH-only client.')
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 8) {
    return false
  }

  if (value === null || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'string') {
    return value.length <= MAX_GATEWAY_FRAME_BYTES
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.length <= 10_000 && value.every(item => boundedJson(item, depth + 1))
  }

  if (!plainRecord(value)) {
    return false
  }

  const entries = Object.entries(value)

  return (
    entries.length <= 256 &&
    entries.every(([key, item]) => key.length <= 128 && !FORBIDDEN_PARAM_KEY.test(key) && boundedJson(item, depth + 1))
  )
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)

  return keys.every(key => allowed.includes(key))
}

function validId(value: unknown): boolean {
  return (
    (typeof value === 'string' && value.length > 0 && value.length <= 256) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  )
}

function validSessionId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function validGatewayProfile(value: unknown): boolean {
  return (
    value === 'default' ||
    (typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !RESERVED_GATEWAY_PROFILES.has(value))
  )
}

function validMiniPath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || !value.startsWith('/')) {
    return false
  }

  return !Array.from(value).some(character => {
    const code = character.charCodeAt(0)

    return code <= 0x1f || code === 0x7f
  })
}

function validGatewayParams(method: string, params: Record<string, unknown>): boolean {
  if (!boundedJson(params)) {
    return false
  }

  if (method === 'prompt.submit') {
    return (
      exactKeys(params, [
        'confirm_empty_truncate',
        'confirm_truncate',
        'interrupted',
        'queued',
        'replace_messages',
        'session_id',
        'surface',
        'text',
        'truncate_before_message_id',
        'truncate_before_row_id',
        'truncate_before_user_ordinal'
      ]) &&
      validSessionId(params.session_id) &&
      typeof params.text === 'string' &&
      params.text.length <= MAX_PROMPT_CHARS
    )
  }

  if (method === 'config.get') {
    return (
      exactKeys(params, ['cwd', 'key', 'session_id']) &&
      ['fast', 'model', 'project', 'reasoning'].includes(String(params.key))
    )
  }

  if (method === 'config.set') {
    if (!exactKeys(params, ['key', 'session_id', 'value']) || !validSessionId(params.session_id)) {
      return false
    }

    const key = String(params.key)
    const value = params.value

    const sessionModel =
      typeof value === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,255} --provider [a-zA-Z0-9][a-zA-Z0-9._-]{0,127} --session$/.test(value)

    return (
      (key === 'fast' && (value === 'fast' || value === 'normal')) ||
      (key === 'reasoning' && typeof value === 'string' && value.length <= 64) ||
      (key === 'model' && sessionModel)
    )
  }

  if (method === 'image.attach_bytes') {
    return (
      exactKeys(params, ['content_base64', 'filename', 'session_id']) &&
      validSessionId(params.session_id) &&
      typeof params.content_base64 === 'string' &&
      typeof params.filename === 'string' &&
      params.filename.length <= 512
    )
  }

  if (method === 'file.attach') {
    return (
      exactKeys(params, ['data_url', 'name', 'path', 'session_id']) &&
      validSessionId(params.session_id) &&
      typeof params.data_url === 'string' &&
      typeof params.name === 'string' &&
      params.name.length <= 512 &&
      params.path === ''
    )
  }

  if (!SAFE_GATEWAY_METHODS.has(method) || !exactKeys(params, SAFE_METHOD_PARAM_KEYS[method] || [])) {
    return false
  }

  if (
    (method.startsWith('session.') && method !== 'session.active_list' && method !== 'session.create') ||
    method.startsWith('process.')
  ) {
    if (!validSessionId(params.session_id)) {
      return false
    }
  }

  if (method === 'commands.catalog') {
    return !('session_id' in params) || validSessionId(params.session_id)
  }

  if (method === 'approval.respond') {
    return validSessionId(params.session_id) && (params.choice === 'once' || params.choice === 'deny')
  }

  if (method === 'session.create') {
    return params.source === 'desktop' && (!('profile' in params) || validGatewayProfile(params.profile))
  }

  if (method === 'session.resume') {
    return params.source === 'desktop' && (!('profile' in params) || validGatewayProfile(params.profile))
  }

  if (method === 'complete.path') {
    if (!validSessionId(params.session_id) || 'cwd' in params || typeof params.word !== 'string') {
      return false
    }

    const match = /^@(file|folder):(.*)$/.exec(params.word)

    if (!match || match[2].length > 4096 || match[2].startsWith('/') || match[2].startsWith('~')) {
      return false
    }

    return !match[2].split('/').some(segment => segment === '..')
  }

  if (method === 'session.compress') {
    return (
      !('focus_topic' in params) ||
      (typeof params.focus_topic === 'string' && params.focus_topic.length > 0 && params.focus_topic.length <= 4096)
    )
  }

  if (method === 'session.cwd.set') {
    return validMiniPath(params.cwd)
  }

  if (method === 'session.redirect') {
    return typeof params.text === 'string' && params.text.length > 0 && params.text.length <= MAX_PROMPT_CHARS
  }

  if (method === 'session.title' && 'title' in params) {
    return typeof params.title === 'string' && params.title.length > 0 && params.title.length <= 512
  }

  if (method === 'profiles.get_asset') {
    return (
      params.asset === 'avatar' &&
      typeof params.name === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(params.name)
    )
  }

  if (method === 'model.options') {
    return params.explicit_only === true && !('refresh' in params)
  }

  return true
}

function assertGatewayFrame(data: unknown): void {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_GATEWAY_FRAME_BYTES) {
    return denied()
  }

  let frame: unknown

  try {
    frame = JSON.parse(data)
  } catch {
    return denied()
  }

  if (!plainRecord(frame) || !exactKeys(frame, ['id', 'jsonrpc', 'method', 'params'])) {
    return denied()
  }

  if (frame.jsonrpc !== '2.0' || !validId(frame.id) || typeof frame.method !== 'string' || !plainRecord(frame.params)) {
    return denied()
  }

  if (!validGatewayParams(frame.method, frame.params)) {
    return denied()
  }
}

function assertVoiceFrame(data: unknown): void {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_VOICE_FRAME_BYTES) {
    return denied()
  }

  let frame: unknown

  try {
    frame = JSON.parse(data)
  } catch {
    return denied()
  }

  if (!plainRecord(frame)) {
    return denied()
  }

  if (exactKeys(frame, ['text']) && typeof frame.text === 'string' && frame.text.length > 0) {
    return
  }

  if (exactKeys(frame, ['done']) && frame.done === true) {
    return
  }

  return denied()
}

export function assertSshOnlyGatewayProxyDataAllowed(purpose: GatewayProxyPurpose, data: unknown): void {
  if (purpose === 'gateway') {
    return assertGatewayFrame(data)
  }

  if (purpose === 'voice') {
    return assertVoiceFrame(data)
  }

  return denied()
}
