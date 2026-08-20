const ORGO_API_BASE = 'https://www.orgo.ai/api'
const COMPUTER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface OrgoDesktopCredentials {
  apiKey: string
  computerId: string
}

export interface OrgoDesktopSession {
  computerId: string
  computerName: string
  instanceId: string
  status: string
  websocketUrl: string
  password: string
}

export interface ResolvedOrgoDesktopProfile<T> {
  entry: T | undefined
  inheritedFromDefault: boolean
}

export interface ResolvedOrgoDesktopProfileBinding<T> extends ResolvedOrgoDesktopProfile<T> {
  profile: string
}

export type OrgoDesktopErrorCode =
  'auth-failed' | 'computer-not-found' | 'invalid-config' | 'invalid-response' | 'network' | 'unavailable'

function isTailscaleIpv4(host: string): boolean {
  const octets = host.split('.').map(Number)

  return (
    octets.length === 4 &&
    octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    octets[0] === 100 &&
    octets[1] >= 64 &&
    octets[1] <= 127
  )
}

export function privateOrgoWebsocketUrl(sshHost: unknown, password: unknown): null | string {
  const host = String(sshHost ?? '')
    .trim()
    .toLowerCase()

  const token = String(password ?? '').trim()
  const privateHost = isTailscaleIpv4(host) || host.endsWith('.ts.net')

  if (!privateHost || !token) {
    return null
  }

  return `ws://${host}:6080/websockify?token=${encodeURIComponent(token)}`
}

export class OrgoDesktopError extends Error {
  code: OrgoDesktopErrorCode

  constructor(code: OrgoDesktopErrorCode, message: string) {
    super(message)
    this.name = 'OrgoDesktopError'
    this.code = code
  }
}

/** Resolve an optional per-agent override, falling back to the app-wide default binding. */
export function resolveOrgoDesktopProfile<T>(
  profiles: Record<string, T>,
  profile: string
): ResolvedOrgoDesktopProfile<T> {
  const direct = profiles[profile]

  if (direct) {
    return { entry: direct, inheritedFromDefault: false }
  }

  const fallback = profile === 'default' ? undefined : profiles.default

  return { entry: fallback, inheritedFromDefault: Boolean(fallback) }
}

/** Resolve a roster in one pass so synchronization cannot accidentally pin
 * every agent to the default computer. Named profiles retain the legacy
 * fallback only when they do not have an explicit binding of their own. */
export function resolveOrgoDesktopProfiles<T>(
  profiles: Record<string, T>,
  names: string[]
): Array<ResolvedOrgoDesktopProfileBinding<T>> {
  return names.map(profile => ({ profile, ...resolveOrgoDesktopProfile(profiles, profile) }))
}

export function normalizeOrgoComputerId(value: unknown): string {
  const computerId = String(value ?? '').trim()

  if (!COMPUTER_ID_RE.test(computerId)) {
    throw new OrgoDesktopError('invalid-config', 'Enter a valid Orgo computer ID.')
  }

  return computerId
}

/** The onboarding key-save stage intentionally runs before a computer exists. */
export function normalizeOptionalOrgoComputerId(value: unknown): string {
  const computerId = String(value ?? '').trim()

  return computerId ? normalizeOrgoComputerId(computerId) : ''
}

function unwrapRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const record = value as Record<string, unknown>

  for (const key of keys) {
    const nested = record[key]

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>
    }
  }

  return record
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new OrgoDesktopError('invalid-response', 'Orgo returned an unreadable response.')
  }
}

async function requireOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }

  if (response.status === 401 || response.status === 403) {
    throw new OrgoDesktopError('auth-failed', 'The Orgo API key was rejected.')
  }

  if (response.status === 404) {
    throw new OrgoDesktopError('computer-not-found', 'That Orgo computer was not found.')
  }

  throw new OrgoDesktopError('unavailable', `Orgo returned HTTP ${response.status}.`)
}

export async function fetchOrgoDesktopSession(
  credentials: OrgoDesktopCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoDesktopSession> {
  const computerId = normalizeOrgoComputerId(credentials.computerId)
  const apiKey = String(credentials.apiKey ?? '').trim()

  if (!apiKey) {
    throw new OrgoDesktopError('invalid-config', 'Enter an Orgo API key.')
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  let computerResponse: Response

  try {
    computerResponse = await fetchImpl(`${ORGO_API_BASE}/computers/${encodeURIComponent(computerId)}`, { headers })
  } catch {
    throw new OrgoDesktopError('network', 'Could not reach the Orgo API.')
  }

  await requireOk(computerResponse)
  const computer = unwrapRecord(await parseJson(computerResponse), ['computer', 'data'])
  let password = String(computer.password ?? computer.vnc_password ?? '').trim()

  // Older Orgo deployments returned the rotating credential separately.
  if (!password) {
    let passwordResponse: Response

    try {
      passwordResponse = await fetchImpl(`${ORGO_API_BASE}/computers/${encodeURIComponent(computerId)}/vnc-password`, {
        headers
      })
    } catch {
      throw new OrgoDesktopError('network', 'Could not reach the Orgo API.')
    }

    await requireOk(passwordResponse)
    const passwordBody = unwrapRecord(await parseJson(passwordResponse), ['data'])
    password = String(passwordBody.password ?? passwordBody.vnc_password ?? '').trim()
  }

  const instanceId = String(
    computer.instance_id ?? computer.instanceId ?? computer.fly_instance_id ?? computer.flyInstanceId ?? ''
  ).trim()

  if (!/^[a-zA-Z0-9-]+$/.test(instanceId) || !password) {
    throw new OrgoDesktopError('invalid-response', 'Orgo did not return usable desktop connection details.')
  }

  return {
    computerId,
    computerName: String(computer.name ?? computerId).trim() || computerId,
    instanceId,
    status: String(computer.status ?? 'unknown').trim() || 'unknown',
    websocketUrl: `wss://www.orgo.ai/desktops/${encodeURIComponent(instanceId)}/ws/websockify?token=${encodeURIComponent(password)}`,
    password
  }
}

export function serializeOrgoDesktopError(error: unknown): { code: OrgoDesktopErrorCode; message: string } {
  if (error instanceof OrgoDesktopError) {
    return { code: error.code, message: error.message }
  }

  return {
    code: 'unavailable',
    message: error instanceof Error && error.message ? error.message : 'Could not connect to the Orgo desktop.'
  }
}
