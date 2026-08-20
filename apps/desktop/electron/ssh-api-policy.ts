type DesktopApiRequest = {
  body?: unknown
  method?: unknown
  path?: unknown
  profile?: unknown
  timeoutMs?: unknown
  upload?: unknown
}

const READ_ONLY_PATHS = new Set(['/api/model/info', '/api/profiles', '/api/profiles/active', '/api/status'])

const SESSION_PATH_RE = /^\/api\/sessions\/[^/]+$/
const SESSION_MESSAGES_PATH_RE = /^\/api\/sessions\/[^/]+\/messages$/
const SESSION_PATCH_KEYS = new Set(['archived', 'pinned', 'profile', 'title'])

function denied(): never {
  throw new Error('This API operation is unavailable in the SSH-only client.')
}

function requestMethod(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'GET'
  }

  if (typeof value !== 'string' || !/^[A-Za-z]+$/.test(value)) {
    return denied()
  }

  return value.toUpperCase()
}

function requestTarget(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return denied()
  }

  const hasControlCharacter = [...value].some(character => {
    const code = character.charCodeAt(0)

    return code < 32 || code === 127
  })

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    hasControlCharacter ||
    /%(?:2e|2f|5c)/i.test(value) ||
    value
      .split(/[?]/, 1)[0]
      .split('/')
      .some(segment => segment === '.' || segment === '..')
  ) {
    return denied()
  }

  let parsed: URL

  try {
    parsed = new URL(value, 'http://korgo.invalid')
  } catch {
    return denied()
  }

  if (parsed.origin !== 'http://korgo.invalid' || parsed.username || parsed.password) {
    return denied()
  }

  return parsed
}

function exactQuery(target: URL, allowed: readonly string[]): boolean {
  const keys = [...target.searchParams.keys()]

  return new Set(keys).size === keys.length && keys.every(key => allowed.includes(key))
}

function boundedInteger(value: string | null, minimum: number, maximum: number, required = false): boolean {
  if (value === null) {
    return !required
  }

  return /^(?:0|[1-9][0-9]*)$/.test(value) && Number(value) >= minimum && Number(value) <= maximum
}

function validProfile(value: string | null, allowAll = false, required = false): boolean {
  if (value === null) {
    return !required
  }

  return (allowAll && value === 'all') || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
}

function validSourceList(value: string | null): boolean {
  return value === null || /^[a-z][a-z0-9_-]{0,31}(?:,[a-z][a-z0-9_-]{0,31})*$/.test(value)
}

function validSessionListQuery(target: URL, profiles: boolean): boolean {
  if (
    !exactQuery(target, [
      'archived',
      'exclude_sources',
      'limit',
      'min_messages',
      'offset',
      'order',
      'profile',
      'source',
      'sources'
    ])
  ) {
    return false
  }

  const query = target.searchParams

  return (
    boundedInteger(query.get('limit'), 0, profiles ? 500 : 100) &&
    boundedInteger(query.get('offset'), 0, 100_000) &&
    boundedInteger(query.get('min_messages'), 0, 1_000_000) &&
    (!query.has('archived') || ['exclude', 'include', 'only'].includes(String(query.get('archived')))) &&
    (!query.has('order') || ['created', 'recent'].includes(String(query.get('order')))) &&
    validProfile(query.get('profile'), profiles) &&
    validSourceList(query.get('source')) &&
    validSourceList(query.get('sources')) &&
    validSourceList(query.get('exclude_sources'))
  )
}

function validReadOnlyTarget(target: URL): boolean {
  const path = target.pathname
  const query = target.searchParams

  if (READ_ONLY_PATHS.has(path)) {
    return exactQuery(target, [])
  }

  if (path === '/api/model/options') {
    return exactQuery(target, ['explicit_only']) && query.get('explicit_only') === '1'
  }

  if (path === '/api/profiles/projects/tree') {
    return exactQuery(target, ['preview_limit']) && boundedInteger(query.get('preview_limit'), 1, 20, true)
  }

  if (path === '/api/sessions') {
    return validSessionListQuery(target, false)
  }

  if (path === '/api/profiles/sessions') {
    return validSessionListQuery(target, true)
  }

  if (path === '/api/profiles/sessions/sidebar') {
    if (
      !exactQuery(target, [
        'cron_limit',
        'messaging_exclude',
        'messaging_limit',
        'recents_exclude',
        'recents_limit',
        'recents_profile'
      ])
    ) {
      return false
    }

    return (
      validProfile(query.get('recents_profile'), true, true) &&
      boundedInteger(query.get('recents_limit'), 1, 500, true) &&
      boundedInteger(query.get('cron_limit'), 1, 500, true) &&
      boundedInteger(query.get('messaging_limit'), 1, 500, true) &&
      validSourceList(query.get('recents_exclude')) &&
      validSourceList(query.get('messaging_exclude'))
    )
  }

  if (path === '/api/sessions/search') {
    return exactQuery(target, ['q']) && query.has('q') && (query.get('q')?.length || 0) <= 512
  }

  if (SESSION_PATH_RE.test(path)) {
    return exactQuery(target, ['profile']) && validProfile(query.get('profile'))
  }

  if (SESSION_MESSAGES_PATH_RE.test(path)) {
    if (!exactQuery(target, ['limit', 'offset', 'order', 'profile'])) {
      return false
    }

    return (
      validProfile(query.get('profile')) &&
      boundedInteger(query.get('limit'), 0, 500) &&
      boundedInteger(query.get('offset'), 0, 1_000_000) &&
      (!query.has('order') || ['latest', 'oldest'].includes(String(query.get('order'))))
    )
  }

  return false
}

function hasBody(value: unknown): boolean {
  return value !== undefined && value !== null
}

function validSessionPatchBody(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const body = value as Record<string, unknown>
  const keys = Object.keys(body)

  if (keys.length === 0 || keys.some(key => !SESSION_PATCH_KEYS.has(key))) {
    return false
  }

  if ('archived' in body && typeof body.archived !== 'boolean') {
    return false
  }

  if ('pinned' in body && typeof body.pinned !== 'boolean') {
    return false
  }

  if ('profile' in body && (typeof body.profile !== 'string' || !validProfile(body.profile))) {
    return false
  }

  if ('title' in body && (typeof body.title !== 'string' || body.title.length > 512)) {
    return false
  }

  return true
}

/**
 * The SSH-only desktop is a chat/session client, not a general credentialed
 * gateway console. Enforce that boundary before backend resolution so a
 * compromised renderer cannot reuse the generic REST bridge for Mini-owned
 * configuration, provider, MCP, browser, update, or maintenance operations.
 */
export function assertSshOnlyApiRequestAllowed(request: DesktopApiRequest): void {
  if (
    !request ||
    typeof request !== 'object' ||
    'upload' in request ||
    ('profile' in request && (typeof request.profile !== 'string' || !validProfile(request.profile))) ||
    ('timeoutMs' in request &&
      (typeof request.timeoutMs !== 'number' ||
        !Number.isFinite(request.timeoutMs) ||
        request.timeoutMs < 1 ||
        request.timeoutMs > 1_800_000))
  ) {
    return denied()
  }

  const method = requestMethod(request.method)
  const target = requestTarget(request.path)
  const path = target.pathname

  if (method === 'GET' && !hasBody(request.body) && validReadOnlyTarget(target)) {
    return
  }

  if (SESSION_PATH_RE.test(path)) {
    if (method === 'DELETE' && !hasBody(request.body) && exactQuery(target, [])) {
      return
    }

    if (method === 'PATCH' && validSessionPatchBody(request.body) && exactQuery(target, [])) {
      return
    }
  }

  return denied()
}
