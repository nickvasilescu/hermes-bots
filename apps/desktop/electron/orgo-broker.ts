import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  fetchOrgoDesktopSession,
  normalizeOrgoComputerId,
  OrgoDesktopError,
  type OrgoDesktopErrorCode,
  serializeOrgoDesktopError
} from './orgo-desktop'
import { BOT_TEMPLATE_REF, isBotProduct } from './product'

export const ORGO_API_BASE = 'https://www.orgo.ai/api'
export const ORGO_MCP_SERVER_NAME = 'orgo'
export const ORGO_AGENT_MCP_SERVER_NAME = 'orgo-agent'
export const ORGO_MCP_TRUST = 'untrusted' as const
export const ORGO_MCP_COMMAND = 'npx'
export const ORGO_MCP_ARGS = ['-y', 'orgo-mcp-server']
export const ORGO_AGENT_MCP_COMMAND = '/usr/local/lib/hermes-agent/venv/bin/python'
export const ORGO_AGENT_MCP_REMOTE_PATH = '/root/.hermes/orgo-agent-mcp.py'
export const ORGO_AGENT_MCP_STAGING_PATH = '/tmp/hermes-orgo-agent-mcp.b64'
export const ORGO_AGENT_MCP_UPLOAD_CHUNK_SIZE = 64 * 1024
export const ORGO_AGENT_MCP_ARGS = [ORGO_AGENT_MCP_REMOTE_PATH]
export const ORGO_AGENT_MCP_TIMEOUT_SECONDS = 960
export const BOT_ORGO_WORKSPACE_NAME = 'Korgo Bot'
export const BOT_ORGO_LEGACY_WORKSPACE_NAME = 'Hermes Bots'
export const BOT_REMOTE_HERMES_REF = 'ad9e8c9b574ec6937cc09d8901ca83a769225963'
export const HERMES_ORGO_INSTALL_SH = 'https://hermes-agent.nousresearch.com/install.sh'
export const HERMES_ORGO_PROBE_COMMAND =
  'command -v hermes >/dev/null 2>&1 && hermes --version'
export const HERMES_ORGO_INSTALL_COMMAND = `curl -fsSL ${HERMES_ORGO_INSTALL_SH} | bash`
export const HERMES_ORGO_SSH_COMPATIBILITY_COMMAND = [
  'help="$(hermes serve --help 2>&1)"',
  'printf "%s" "$help" | grep -q ssh-session-token-file',
  'printf "%s" "$help" | grep -q ssh-owner-nonce'
].join(' && ')
export const HERMES_ORGO_PINNED_UPDATE_COMMAND = [
  'project=/usr/local/lib/hermes-agent',
  'test "$(git -C "$project" remote get-url origin 2>/dev/null)" = "https://github.com/NousResearch/hermes-agent.git" || { echo "Unexpected Hermes source checkout"; exit 1; }',
  'test -z "$(git -C "$project" status --porcelain --untracked-files=no)" || { echo "Hermes source checkout has local changes"; exit 1; }',
  `git -C "$project" fetch --depth=1 origin ${BOT_REMOTE_HERMES_REF}`,
  `git -C "$project" checkout --detach ${BOT_REMOTE_HERMES_REF}`,
  '"$project/venv/bin/python" -m pip install --disable-pip-version-check --no-input -e "$project"'
].join('\n')
export const TAILSCALE_INSTALL_COMMAND = [
  'if ! command -v tailscale >/dev/null 2>&1 || { ! command -v tailscaled >/dev/null 2>&1 && [ ! -x /usr/sbin/tailscaled ]; }; then',
  '  curl -fsSL https://tailscale.com/install.sh | sh',
  'fi',
  'command -v tailscale >/dev/null 2>&1 && { command -v tailscaled >/dev/null 2>&1 || [ -x /usr/sbin/tailscaled ]; }'
].join('\n')
export const TAILSCALE_INSTALL_TIMEOUT_SECONDS = 180
export const TAILSCALE_AUTH_LOG_PATH = '/tmp/korgo-tailscale-auth.log'
export const TAILSCALE_STATUS_SUMMARY_URL = 'https://status.tailscale.com/api/v2/summary.json'
export const TAILSCALE_AUTH_POLL_COMMAND = [
  'command -v timeout >/dev/null 2>&1 && timeout 5s tailscale status --json 2>/dev/null || true',
  `test -f ${TAILSCALE_AUTH_LOG_PATH} && tail -c 8192 ${TAILSCALE_AUTH_LOG_PATH} 2>/dev/null || true`
].join('\n')
export const ORGO_SILK_WALLPAPER_PATH = '/root/Pictures/desktop-silk-wallpaper.png'
export const ORGO_DEFAULT_WALLPAPER_PATH = '/usr/share/backgrounds/orgo-background.png'
export const ORGO_WALLPAPER_STAGING_PATH = '/tmp/hermes-desktop-silk-wallpaper.b64'
export const ORGO_WALLPAPER_UPLOAD_CHUNK_SIZE = 64 * 1024
export const ORGO_SILK_WALLPAPER_MD5 = '7febc8b0943cddc162bb544de31008bb'
export const ORGO_WALLPAPER_PROBE_COMMAND = [
  `test -f ${ORGO_SILK_WALLPAPER_PATH}`,
  `md5sum ${ORGO_SILK_WALLPAPER_PATH} | awk '{print $1}' | grep -qx ${ORGO_SILK_WALLPAPER_MD5}`
].join(' && ')

export const TAILSCALE_START_COMMAND = [
  'tailscaled_bin="$(command -v tailscaled 2>/dev/null || true)"',
  '[ -n "$tailscaled_bin" ] || tailscaled_bin=/usr/sbin/tailscaled',
  '[ -x "$tailscaled_bin" ] || { echo "tailscaled executable not found"; exit 1; }',
  'if ! timeout 3s tailscale status --json >/dev/null 2>&1; then',
  '  command -v pkill >/dev/null 2>&1 && pkill -x tailscaled >/dev/null 2>&1 || true',
  '  sleep 1',
  '  mkdir -p /var/lib/tailscale /var/run/tailscale',
  '  if command -v setsid >/dev/null 2>&1; then',
  '    setsid -f "$tailscaled_bin" --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock >/var/log/tailscaled.log 2>&1 </dev/null',
  '  else',
  '    nohup "$tailscaled_bin" --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock >/var/log/tailscaled.log 2>&1 </dev/null &',
  '  fi',
  'fi',
  'for attempt in 1 2 3 4 5 6; do',
  '  timeout 2s tailscale status --json >/dev/null 2>&1 && exit 0',
  '  sleep 1',
  'done',
  'echo "tailscaled did not start"',
  'test -f /var/log/tailscaled.log && tail -n 20 /var/log/tailscaled.log || true',
  'exit 1'
].join('\n')

const COMPUTER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface OrgoWorkspaceSummary {
  id: string
  name: string
  status?: string
}

export interface OrgoComputerSummary {
  id: string
  name: string
  status: string
  workspaceId?: string
  templateRef?: string
}

export interface OrgoInventory {
  workspaces: OrgoWorkspaceSummary[]
  computers: OrgoComputerSummary[]
}

export interface OrgoMcpEntry {
  command: string
  args: string[]
  env: Record<string, string>
  trust: typeof ORGO_MCP_TRUST
  timeout?: number
}

export interface OrgoDoctorResult {
  ok: boolean
  apiAuth: boolean
  computerStatus: string
  vncAvailable: boolean
  mcpReady: boolean
  hermesInstalled: boolean
  message: string
}

export interface OrgoBashResult {
  output: string
  success: boolean
  exitCode: number | null
}

export interface TailscaleNodeStatus {
  installed: boolean
  connected: boolean
  dnsName: string
  backendState: string
  authUrl: string
}

export interface OrgoBrokerState {
  apiKey: string
  computerId: string
  workspaceId: string
}

function unwrapList(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  const record = value as Record<string, unknown>

  for (const key of keys) {
    const nested = record[key]

    if (Array.isArray(nested)) {
      return nested
    }
  }

  return []
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

export function orgoAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json'
  }
}

export function orgoMcpEntry(computerId: string): OrgoMcpEntry {
  const id = normalizeOrgoComputerId(computerId)

  return {
    command: ORGO_MCP_COMMAND,
    args: [...ORGO_MCP_ARGS],
    env: {
      ORGO_API_KEY: '${env:ORGO_API_KEY}',
      ORGO_DEFAULT_COMPUTER_ID: id,
      ORGO_TOOLSETS: 'core,screen,shell,files'
    },
    trust: ORGO_MCP_TRUST
  }
}

export function orgoAgentMcpEntry(computerId: string): OrgoMcpEntry {
  const id = normalizeOrgoComputerId(computerId)

  return {
    command: ORGO_AGENT_MCP_COMMAND,
    args: [...ORGO_AGENT_MCP_ARGS],
    env: {
      ORGO_API_KEY: '${env:ORGO_API_KEY}',
      ORGO_DEFAULT_COMPUTER_ID: id,
      ORGO_AGENT_MAX_STEPS: '30',
      ORGO_AGENT_TIMEOUT_SECONDS: '900'
    },
    trust: ORGO_MCP_TRUST,
    timeout: ORGO_AGENT_MCP_TIMEOUT_SECONDS
  }
}

export function orgoMcpEntries(computerId: string): Record<string, OrgoMcpEntry> {
  return {
    [ORGO_MCP_SERVER_NAME]: orgoMcpEntry(computerId),
    [ORGO_AGENT_MCP_SERVER_NAME]: orgoAgentMcpEntry(computerId)
  }
}

export function orgoProcessEnv(state: Pick<OrgoBrokerState, 'apiKey' | 'computerId'>): Record<string, string> {
  const apiKey = String(state.apiKey || '').trim()
  const computerId = String(state.computerId || '').trim()
  const env: Record<string, string> = {}

  if (apiKey) {
    env.ORGO_API_KEY = apiKey
  }

  if (COMPUTER_ID_RE.test(computerId)) {
    env.ORGO_DEFAULT_COMPUTER_ID = computerId
  }

  return env
}

async function orgoRequest(
  apiKey: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  let response: Response

  try {
    response = await fetchImpl(`${ORGO_API_BASE}${path}`, {
      ...init,
      headers: { ...orgoAuthHeaders(apiKey), ...(init.headers || {}) }
    })
  } catch {
    throw new OrgoDesktopError('network', 'Could not reach the Orgo API.')
  }

  await requireOk(response)

  if (response.status === 204) {
    return null
  }

  return parseJson(response)
}

function asWorkspace(value: unknown): OrgoWorkspaceSummary | null {
  const record = unwrapRecord(value, ['workspace', 'data', 'project'])
  const id = String(record.id ?? record.workspace_id ?? record.project_id ?? '').trim()
  const name = String(record.name ?? record.title ?? id).trim()

  if (!id) {
    return null
  }

  return { id, name: name || id, status: String(record.status ?? '').trim() || undefined }
}

export function pickOrgoWorkspaceByName(
  workspaces: OrgoWorkspaceSummary[],
  name: string
): OrgoWorkspaceSummary | undefined {
  const target = name.trim().toLowerCase()

  return workspaces.find(workspace => workspace.name.trim().toLowerCase() === target)
}

function asComputer(value: unknown): OrgoComputerSummary | null {
  const record = unwrapRecord(value, ['computer', 'data'])
  const id = String(record.id ?? record.computer_id ?? '').trim()
  const name = String(record.name ?? id).trim()
  const status = String(record.status ?? 'unknown').trim() || 'unknown'

  if (!COMPUTER_ID_RE.test(id)) {
    return null
  }

  return {
    id,
    name: name || id,
    status,
    workspaceId: String(record.workspace_id ?? record.project_id ?? '').trim() || undefined,
    templateRef: String(record.template_ref ?? record.templateRef ?? '').trim() || undefined
  }
}

export function isHermesAgentTemplate(ref: string | undefined): boolean {
  return /^system\/hermes-agent@/i.test(String(ref || '').trim())
}

export function pickSharedHermesComputer(
  computers: OrgoComputerSummary[],
  exactTemplateRef?: string,
  preferredName = 'Shared computer'
): OrgoComputerSummary | undefined {
  const candidates = computers.filter(computer => computer.status.trim().toLowerCase() !== 'deleted')

  if (exactTemplateRef) {
    const exact = candidates.find(computer => computer.templateRef === exactTemplateRef)

    if (exact) {
      return exact
    }

    // Workspace summaries currently omit template_ref even for computers
    // created from a template. In the app-owned workspace, the canonical
    // computer name is the stable fallback that keeps retries idempotent.
    const targetName = preferredName.trim().toLowerCase()

    return candidates.find(
      computer => !computer.templateRef && computer.name.trim().toLowerCase() === targetName
    )
  }

  return candidates.find(computer => isHermesAgentTemplate(computer.templateRef)) || candidates[0]
}

export async function listOrgoWorkspaces(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<OrgoWorkspaceSummary[]> {
  const payload = await orgoRequest(apiKey, '/workspaces', {}, fetchImpl)

  return unwrapList(payload, ['workspaces', 'data', 'projects']).map(asWorkspace).filter(Boolean) as OrgoWorkspaceSummary[]
}

export async function createOrgoWorkspace(
  apiKey: string,
  name: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoWorkspaceSummary> {
  const payload = await orgoRequest(apiKey, '/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name: name.trim() || BOT_ORGO_WORKSPACE_NAME })
  }, fetchImpl)

  const workspace = asWorkspace(payload)

  if (!workspace) {
    throw new OrgoDesktopError('invalid-response', 'Orgo did not return a workspace.')
  }

  return workspace
}

export async function findOrCreateOrgoWorkspace(
  apiKey: string,
  name: string,
  aliases: string[] = [],
  fetchImpl: typeof fetch = fetch
): Promise<OrgoWorkspaceSummary> {
  const names = [name, ...aliases].map(candidate => candidate.trim()).filter(Boolean)

  const pick = (workspaces: OrgoWorkspaceSummary[]) => {
    for (const candidate of names) {
      const workspace = pickOrgoWorkspaceByName(workspaces, candidate)

      if (workspace) {
        return workspace
      }
    }

    return undefined
  }

  const existing = pick(await listOrgoWorkspaces(apiKey, fetchImpl))

  if (existing) {
    return existing
  }

  try {
    return await createOrgoWorkspace(apiKey, name, fetchImpl)
  } catch (createError) {
    // A concurrent setup or an eventually-consistent list can race the POST
    // and produce 409. Re-list once and adopt the resource if it now exists.
    try {
      const recovered = pick(await listOrgoWorkspaces(apiKey, fetchImpl))

      if (recovered) {
        return recovered
      }
    } catch {
      // Preserve the create error; it is the actionable failure.
    }

    throw createError
  }
}

export async function listOrgoComputers(
  apiKey: string,
  workspaceId?: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoComputerSummary[]> {
  if (!workspaceId) {
    const payload = await orgoRequest(apiKey, '/workspaces', {}, fetchImpl)
    const workspaces = unwrapList(payload, ['workspaces', 'data', 'projects'])

    return workspaces.flatMap(workspace =>
      unwrapList(workspace, ['computers', 'desktops']).map(asComputer).filter(Boolean)
    ) as OrgoComputerSummary[]
  }

  // Orgo's workspace response embeds its computers. GET /computers is not a
  // list endpoint and returns 405, so scope discovery through the workspace.
  const payload = await orgoRequest(apiKey, `/workspaces/${encodeURIComponent(workspaceId)}`, {}, fetchImpl)
  const workspace = unwrapRecord(payload, ['workspace', 'data', 'project'])

  return unwrapList(workspace, ['computers', 'desktops']).map(asComputer).filter(Boolean) as OrgoComputerSummary[]
}

/** Load every workspace and computer the supplied key is allowed to see.
 *
 * Orgo owns the authorization boundary: an account-wide key returns the
 * account's owned/shared workspaces, while a workspace-scoped key returns only
 * its workspace. The desktop never widens that result or infers a role from
 * local profile state.
 *
 * Some Orgo deployments embed computers in GET /workspaces and some return
 * workspace summaries only. Reuse embedded lists when present, then fetch only
 * the missing workspace details in small parallel batches.
 */
export async function listOrgoInventory(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoInventory> {
  const payload = await orgoRequest(apiKey, '/workspaces', {}, fetchImpl)
  const records = unwrapList(payload, ['workspaces', 'data', 'projects'])
  const workspaces = records.map(asWorkspace).filter(Boolean) as OrgoWorkspaceSummary[]
  const embedded = new Map<string, OrgoComputerSummary[]>()

  for (const value of records) {
    const record = unwrapRecord(value, ['workspace', 'data', 'project'])
    const workspace = asWorkspace(record)

    if (!workspace) {
      continue
    }

    const hasEmbeddedList = Array.isArray(record.computers) || Array.isArray(record.desktops)

    if (hasEmbeddedList) {
      const computers = unwrapList(record, ['computers', 'desktops'])
        .map(asComputer)
        .filter(Boolean)
        .map(computer => ({ ...computer, workspaceId: computer?.workspaceId || workspace.id })) as OrgoComputerSummary[]

      embedded.set(workspace.id, computers)
    }
  }

  const computers: OrgoComputerSummary[] = []
  const missing = workspaces.filter(workspace => !embedded.has(workspace.id))

  for (let index = 0; index < missing.length; index += 6) {
    const batch = missing.slice(index, index + 6)

    const loaded = await Promise.all(
      batch.map(async workspace => {
        const available = await listOrgoComputers(apiKey, workspace.id, fetchImpl)

        return available.map(computer => ({ ...computer, workspaceId: computer.workspaceId || workspace.id }))
      })
    )

    computers.push(...loaded.flat())
  }

  for (const workspace of workspaces) {
    computers.push(...(embedded.get(workspace.id) || []))
  }

  return { workspaces, computers }
}

export async function resolveHermesAgentTemplateRef(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (isBotProduct()) {
    return BOT_TEMPLATE_REF
  }

  try {
    const payload = await orgoRequest(apiKey, '/templates/global', {}, fetchImpl)

    const refs = unwrapList(payload, ['templates', 'data'])
      .map(item => {
        if (typeof item === 'string') {
          return item
        }

        const record = unwrapRecord(item, ['template'])

        return String(record.ref ?? '').trim()
      })
      .filter(isHermesAgentTemplate)
      .sort()

    return refs.at(-1) || BOT_TEMPLATE_REF
  } catch {
    return BOT_TEMPLATE_REF
  }
}

export async function createOrgoComputer(
  apiKey: string,
  input: { workspaceId: string; name?: string; templateRef?: string },
  fetchImpl: typeof fetch = fetch
): Promise<OrgoComputerSummary> {
  const payload = await orgoRequest(apiKey, '/computers', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      name: input.name?.trim() || 'Shared computer',
      template_ref: input.templateRef || BOT_TEMPLATE_REF,
      os: 'linux',
      ram: 8,
      cpu: 4
    })
  }, fetchImpl)

  const computer = asComputer(payload)

  if (!computer) {
    throw new OrgoDesktopError('invalid-response', 'Orgo did not return a computer.')
  }

  return computer
}

export async function findOrCreateSharedHermesComputer(
  apiKey: string,
  input: { workspaceId: string; name?: string; templateRef?: string },
  fetchImpl: typeof fetch = fetch
): Promise<OrgoComputerSummary> {
  const name = input.name?.trim() || 'Shared computer'

  const pick = (computers: OrgoComputerSummary[]) =>
    pickSharedHermesComputer(computers, input.templateRef, name)

  const existing = pick(await listOrgoComputers(apiKey, input.workspaceId, fetchImpl))

  if (existing) {
    return existing
  }

  try {
    return await createOrgoComputer(apiKey, { ...input, name }, fetchImpl)
  } catch (createError) {
    // Recover from duplicate-name conflicts and create responses that time out
    // after Orgo has already accepted the computer.
    try {
      const recovered = pick(await listOrgoComputers(apiKey, input.workspaceId, fetchImpl))

      if (recovered) {
        return recovered
      }
    } catch {
      // Preserve the create error; it is the actionable failure.
    }

    throw createError
  }
}

export async function getOrgoComputer(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoComputerSummary> {
  const payload = await orgoRequest(apiKey, `/computers/${encodeURIComponent(normalizeOrgoComputerId(computerId))}`, {}, fetchImpl)
  const computer = asComputer(payload)

  if (!computer) {
    throw new OrgoDesktopError('invalid-response', 'Orgo did not return computer details.')
  }

  return computer
}

export async function ensureOrgoComputerRunning(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<OrgoComputerSummary> {
  const id = normalizeOrgoComputerId(computerId)
  let computer = await getOrgoComputer(apiKey, id, fetchImpl)

  if (computer.status === 'running') {
    return computer
  }

  await orgoRequest(apiKey, `/computers/${encodeURIComponent(id)}/start`, { method: 'POST' }, fetchImpl)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    computer = await getOrgoComputer(apiKey, id, fetchImpl)

    if (computer.status === 'running') {
      return computer
    }

    if (computer.status === 'error') {
      throw new OrgoDesktopError('unavailable', 'The Orgo computer entered an error state.')
    }

    await sleep(1_500)
  }

  throw new OrgoDesktopError('unavailable', 'Timed out waiting for the Orgo computer to start.')
}

export function parseOrgoBashResult(value: unknown): OrgoBashResult {
  const record = unwrapRecord(value, ['data', 'result'])
  const exitCode = typeof record.exit_code === 'number' ? record.exit_code : null
  const output = String(record.output ?? record.stdout ?? '')
  const accepted = record.success !== false

  return {
    output,
    exitCode,
    success: accepted && (exitCode === null || exitCode === 0)
  }
}

export async function runOrgoBash(
  apiKey: string,
  computerId: string,
  command: string,
  fetchImpl: typeof fetch = fetch,
  timeout = 30
): Promise<OrgoBashResult> {
  const payload = await orgoRequest(
    apiKey,
    `/computers/${encodeURIComponent(normalizeOrgoComputerId(computerId))}/bash`,
    { method: 'POST', body: JSON.stringify({ command, timeout }) },
    fetchImpl
  )

  return parseOrgoBashResult(payload)
}

export function extractTailscaleAuthUrl(output: string): string {
  return String(output || '').match(/https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_-]+/)?.[0] || ''
}

export function parseTailscaleStatus(output: string): TailscaleNodeStatus {
  const text = String(output || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start === -1 || end < start) {
    return {
      installed: Boolean(text),
      connected: false,
      dnsName: '',
      backendState: '',
      authUrl: extractTailscaleAuthUrl(text)
    }
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      BackendState?: string
      Self?: { DNSName?: string; Online?: boolean }
      AuthURL?: string
    }

    const backendState = String(parsed.BackendState || '')
    const dnsName = String(parsed.Self?.DNSName || '').replace(/\.$/, '')

    return {
      installed: true,
      connected: backendState === 'Running' && parsed.Self?.Online !== false && Boolean(dnsName),
      dnsName,
      backendState,
      authUrl: String(parsed.AuthURL || '') || extractTailscaleAuthUrl(text)
    }
  } catch {
    return {
      installed: true,
      connected: false,
      dnsName: '',
      backendState: 'InvalidStatus',
      authUrl: extractTailscaleAuthUrl(text)
    }
  }
}

export function tailscaleHostnameForComputer(computerId: string): string {
  return `hermes-bots-${normalizeOrgoComputerId(computerId).slice(0, 8)}`
}

export function buildTailscaleAuthLaunchCommand(hostname: string): string {
  // `--json` is essential here. Tailscale deliberately writes the AuthURL as
  // the first JSON object before waiting for browser authorization, which lets
  // the detached process expose the URL through its log immediately.
  const action = `tailscale up --json --ssh --hostname=${hostname}`

  return [
    // A detached interactive login remains alive while the browser challenge is
    // pending. Kill only stale CLI clients before replacing it; competing `up`
    // processes each reset tailscaled's registration and can prevent every one
    // of them from receiving an AuthURL. Never kill the daemon here.
    "command -v pkill >/dev/null 2>&1 && pkill -f '^tailscale (up|login)( |$)' >/dev/null 2>&1 || true",
    'sleep 1',
    `rm -f ${TAILSCALE_AUTH_LOG_PATH}`,
    'if command -v setsid >/dev/null 2>&1; then',
    `  setsid -f sh -c 'exec ${action} >${TAILSCALE_AUTH_LOG_PATH} 2>&1 </dev/null'`,
    'else',
    `  nohup ${action} >${TAILSCALE_AUTH_LOG_PATH} 2>&1 </dev/null &`,
    'fi',
    "printf 'started'"
  ].join('\n')
}

async function runTailscaleSetupStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    throw new OrgoDesktopError('unavailable', `${label}: ${detail}`)
  }
}

function tailscaleCommandWasCancelled(result: OrgoBashResult): boolean {
  return !result.success && /(?:context cancel+ed|deadline exceeded)/i.test(result.output)
}

/** Orgo can end a completed or still-running bash request with a transient
 * `context canceled` response at its request boundary. Tailscale install/start
 * commands are idempotent, so retrying once is both safe and much friendlier
 * than stranding onboarding after the computer has already been provisioned. */
async function runRetryableTailscaleCommand(
  apiKey: string,
  computerId: string,
  command: string,
  fetchImpl: typeof fetch,
  timeout = 30
): Promise<OrgoBashResult> {
  const first = await runOrgoBash(apiKey, computerId, command, fetchImpl, timeout)

  return tailscaleCommandWasCancelled(first)
    ? runOrgoBash(apiKey, computerId, command, fetchImpl, timeout)
    : first
}

async function pollTailscaleAuthorization(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch,
  sleepImpl: (milliseconds: number) => Promise<void>
): Promise<{ output: string; status: TailscaleNodeStatus }> {
  let output = ''
  let status = parseTailscaleStatus('')

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await runOrgoBash(apiKey, computerId, TAILSCALE_AUTH_POLL_COMMAND, fetchImpl, 10)
    // Keep only the latest bounded snapshot. Accumulating every full
    // `tailscale status --json` response produced megabyte-scale UI errors.
    output = result.output.slice(-8192)
    status = parseTailscaleStatus(result.output)

    if (status.connected || status.authUrl) {
      break
    }

    if (attempt < 19) {
      await sleepImpl(1_000)
    }
  }

  return { output, status }
}

async function hasActiveTailscaleCoordinationIncident(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(TAILSCALE_STATUS_SUMMARY_URL, {
      headers: { Accept: 'application/json' }
    })

    if (!response.ok) {
      return false
    }

    const payload = (await response.json()) as {
      components?: Array<{ name?: string; status?: string }>
    }

    return Boolean(
      payload.components?.some(
        component =>
          component.name === 'Coordination service' &&
          component.status !== undefined &&
          component.status !== 'operational'
      )
    )
  } catch {
    // The status page is advisory. Preserve the actionable local error if it
    // cannot be reached rather than turning a diagnostic probe into a blocker.
    return false
  }
}

export async function getOrgoTailscaleStatus(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch
): Promise<TailscaleNodeStatus> {
  const result = await runOrgoBash(
    apiKey,
    computerId,
    'command -v timeout >/dev/null 2>&1 && timeout 5s tailscale status --json 2>/dev/null || true',
    fetchImpl
  )

  return parseTailscaleStatus(result.output)
}

/** Join the Orgo VM to the user's tailnet and enable Tailscale SSH. The API key
 * remains in Electron; the returned auth URL carries only Tailscale's one-time
 * node authorization challenge. */
export async function beginOrgoTailscaleSetup(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch,
  sleepImpl: (milliseconds: number) => Promise<void> = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<TailscaleNodeStatus> {
  await runTailscaleSetupStep('Could not start the Orgo computer', () =>
    ensureOrgoComputerRunning(apiKey, computerId, fetchImpl)
  )

  const install = await runTailscaleSetupStep('Could not install Tailscale', () =>
    runRetryableTailscaleCommand(
      apiKey,
      computerId,
      TAILSCALE_INSTALL_COMMAND,
      fetchImpl,
      TAILSCALE_INSTALL_TIMEOUT_SECONDS
    )
  )

  if (!install.success) {
    const detail = install.output.trim()

    throw new OrgoDesktopError(
      'unavailable',
      detail ? `Could not install Tailscale: ${detail}` : 'Could not install Tailscale on Orgo.'
    )
  }

  const start = await runTailscaleSetupStep('Could not start tailscaled', () =>
    runRetryableTailscaleCommand(apiKey, computerId, TAILSCALE_START_COMMAND, fetchImpl)
  )

  if (!start.success) {
    const detail = start.output.trim()

    throw new OrgoDesktopError(
      'unavailable',
      detail ? `Could not start Tailscale: ${detail}` : 'Could not start Tailscale on Orgo.'
    )
  }

  const current = await runTailscaleSetupStep('Could not read Tailscale status', () =>
    getOrgoTailscaleStatus(apiKey, computerId, fetchImpl)
  )

  if (current.connected) {
    await runTailscaleSetupStep('Could not enable Tailscale SSH', () =>
      runOrgoBash(apiKey, computerId, 'tailscale set --ssh=true >/dev/null 2>&1 || true', fetchImpl)
    )

    return current
  }

  // A previous detached authorization may have received its challenge after
  // the UI stopped waiting. Reuse it instead of restarting registration.
  if (current.authUrl) {
    return { ...current, installed: true }
  }

  const hostname = tailscaleHostnameForComputer(computerId)

  const launch = await runTailscaleSetupStep('Could not begin Tailscale authorization', () =>
    runRetryableTailscaleCommand(
      apiKey,
      computerId,
      buildTailscaleAuthLaunchCommand(hostname),
      fetchImpl,
      15
    )
  )

  if (!launch.success) {
    const detail = launch.output.trim()

    throw new OrgoDesktopError(
      'unavailable',
      detail ? `Could not begin Tailscale authorization: ${detail}` : 'Could not begin Tailscale authorization.'
    )
  }

  const authorization = await runTailscaleSetupStep('Could not read Tailscale authorization', () =>
    pollTailscaleAuthorization(apiKey, computerId, fetchImpl, sleepImpl)
  )

  if (!authorization.status.connected && !authorization.status.authUrl) {
    if (await hasActiveTailscaleCoordinationIncident(fetchImpl)) {
      throw new OrgoDesktopError(
        'unavailable',
        'Tailscale is currently reporting a coordination-service outage, so it cannot issue the cloud computer sign-in link. This is not related to your Tailscale plan. Wait a few minutes, then try again or check https://status.tailscale.com.'
      )
    }

    throw new OrgoDesktopError(
      'unavailable',
      `Tailscale registration did not return a sign-in link (state: ${
        authorization.status.backendState || 'unknown'
      }). Wait a minute and try again; if it continues, check https://status.tailscale.com.`
    )
  }

  return {
    ...authorization.status,
    installed: true
  }
}

/** Confirm Hermes is on the shared VM. Prefer Orgo's curated
 *  `system/hermes-agent@*` snapshot; only run install.sh on a blank computer. */
export async function ensureHermesInstalledOnOrgo(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ installed: boolean; installedNow: boolean; updatedNow: boolean; output: string; fromTemplate: boolean }> {
  const computer = await ensureOrgoComputerRunning(apiKey, computerId, fetchImpl)
  const fromTemplate = isHermesAgentTemplate(computer.templateRef)
  const compatibleTemplate = isBotProduct() ? computer.templateRef === BOT_TEMPLATE_REF : fromTemplate
  const probe = await runOrgoBash(apiKey, computerId, HERMES_ORGO_PROBE_COMMAND, fetchImpl)

  if (probe.success) {
    if (!isBotProduct()) {
      return { installed: true, installedNow: false, updatedNow: false, fromTemplate, output: probe.output }
    }

    const compatibility = await runOrgoBash(
      apiKey,
      computerId,
      HERMES_ORGO_SSH_COMPATIBILITY_COMMAND,
      fetchImpl
    )

    if (compatibility.success) {
      return { installed: true, installedNow: false, updatedNow: false, fromTemplate, output: probe.output }
    }

    const update = await runOrgoBash(
      apiKey,
      computerId,
      HERMES_ORGO_PINNED_UPDATE_COMMAND,
      fetchImpl,
      180
    )

    if (!update.success) {
      throw new OrgoDesktopError(
        'unavailable',
        update.output.trim() || 'Could not update Hermes for secure Desktop SSH.'
      )
    }

    const verify = await runOrgoBash(
      apiKey,
      computerId,
      HERMES_ORGO_SSH_COMPATIBILITY_COMMAND,
      fetchImpl
    )

    if (!verify.success) {
      throw new OrgoDesktopError('unavailable', 'The pinned Hermes update does not support secure Desktop SSH.')
    }

    return {
      installed: true,
      installedNow: false,
      updatedNow: true,
      fromTemplate,
      output: update.output || probe.output
    }
  }

  if (compatibleTemplate) {
    return {
      installed: true,
      installedNow: false,
      updatedNow: false,
      fromTemplate: true,
      output: probe.output || computer.templateRef || BOT_TEMPLATE_REF
    }
  }

  if (isBotProduct()) {
    throw new OrgoDesktopError(
      'unavailable',
      `Korgo Bot will not install an unpinned Hermes build. Use the ${BOT_TEMPLATE_REF} Orgo template or select a computer that already has Hermes installed.`
    )
  }

  const install = await runOrgoBash(apiKey, computerId, HERMES_ORGO_INSTALL_COMMAND, fetchImpl)

  if (!install.success) {
    throw new OrgoDesktopError(
      'unavailable',
      install.output.trim() || 'Could not install Hermes on the Orgo computer.'
    )
  }

  const verify = await runOrgoBash(apiKey, computerId, HERMES_ORGO_PROBE_COMMAND, fetchImpl)

  if (!verify.success) {
    throw new OrgoDesktopError('unavailable', 'Hermes installed on Orgo but `hermes` is not on PATH.')
  }

  return {
    installed: true,
    installedNow: true,
    updatedNow: false,
    fromTemplate: false,
    output: verify.output || install.output
  }
}

/** Place the Orgo credential in the remote Hermes secret environment, never
 * in a profile's MCP definition. Hermes resolves `${env:ORGO_API_KEY}` when it
 * starts the untrusted MCP server. */
export async function persistOrgoEnvironmentOnRemote(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const id = normalizeOrgoComputerId(computerId)
  const encodedKey = Buffer.from(String(apiKey || '').trim(), 'utf8').toString('base64')

  const script = [
    'from pathlib import Path',
    'import base64, os',
    "path = Path('/root/.hermes/.env')",
    'path.parent.mkdir(parents=True, exist_ok=True)',
    "values = {'ORGO_API_KEY': base64.b64decode('" + encodedKey + "').decode(), 'ORGO_DEFAULT_COMPUTER_ID': '" + id + "'}",
    "lines = path.read_text().splitlines() if path.exists() else []",
    "kept = [line for line in lines if not any(line.startswith(key + '=') for key in values)]",
    "path.write_text('\\n'.join(kept + [key + '=' + value for key, value in values.items()]) + '\\n')",
    'os.chmod(path, 0o600)'
  ].join('; ')

  const result = await runOrgoBash(
    apiKey,
    id,
    `python3 -c ${JSON.stringify(script)}`,
    fetchImpl
  )

  if (!result.success) {
    throw new OrgoDesktopError('unavailable', result.output.trim() || 'Could not configure Orgo for remote Hermes.')
  }
}

export function resolveOrgoAgentMcpAssetPath(appRoot: string, resourcesPath = ''): string | null {
  for (const candidate of [
    resourcesPath ? path.join(resourcesPath, 'orgo', 'orgo-agent-mcp.py') : '',
    path.resolve(appRoot, '..', '..', 'hermes_cli', 'orgo_agent_mcp.py')
  ]) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function readBundledOrgoAgentMcpBytes(appRoot: string, resourcesPath = ''): Buffer {
  const assetPath = resolveOrgoAgentMcpAssetPath(appRoot, resourcesPath)

  if (!assetPath) {
    throw new OrgoDesktopError('unavailable', 'The Orgo agent tool is missing from the app bundle.')
  }

  return fs.readFileSync(assetPath)
}

export function buildOrgoAgentMcpProbeCommand(sha256: string): string {
  return [
    `test -f ${ORGO_AGENT_MCP_REMOTE_PATH}`,
    `sha256sum ${ORGO_AGENT_MCP_REMOTE_PATH} | awk '{print $1}' | grep -qx ${sha256}`
  ].join(' && ')
}

export function buildOrgoAgentMcpInstallCommands(base64Payload: string): string[] {
  const payload = String(base64Payload || '').replace(/\s/g, '')

  if (!payload) {
    throw new OrgoDesktopError('unavailable', 'The bundled Orgo agent tool is empty.')
  }

  const script = [
    'import base64, os, pathlib',
    `staging = pathlib.Path(${JSON.stringify(ORGO_AGENT_MCP_STAGING_PATH)})`,
    `target = pathlib.Path(${JSON.stringify(ORGO_AGENT_MCP_REMOTE_PATH)})`,
    'data = base64.b64decode(staging.read_text())',
    'target.parent.mkdir(parents=True, exist_ok=True)',
    "temporary = target.with_suffix('.tmp')",
    'temporary.write_bytes(data)',
    'os.chmod(temporary, 0o600)',
    'os.replace(temporary, target)',
    'staging.unlink(missing_ok=True)'
  ].join('\n')

  const encodedScript = Buffer.from(script, 'utf8').toString('base64')
  const commands = [`umask 077; : > ${ORGO_AGENT_MCP_STAGING_PATH}`]

  for (let offset = 0; offset < payload.length; offset += ORGO_AGENT_MCP_UPLOAD_CHUNK_SIZE) {
    const chunk = payload.slice(offset, offset + ORGO_AGENT_MCP_UPLOAD_CHUNK_SIZE)
    commands.push(`printf %s ${JSON.stringify(chunk)} >> ${ORGO_AGENT_MCP_STAGING_PATH}`)
  }

  commands.push(`printf %s ${JSON.stringify(encodedScript)} | base64 -d | python3`)

  return commands
}

export async function ensureOrgoAgentMcpServer(
  apiKey: string,
  computerId: string,
  readServerBytes: () => Buffer,
  fetchImpl: typeof fetch = fetch
): Promise<{ installedNow: boolean; output: string }> {
  const serverBytes = readServerBytes()
  const sha256 = crypto.createHash('sha256').update(serverBytes).digest('hex')
  const probeCommand = buildOrgoAgentMcpProbeCommand(sha256)
  const probe = await runOrgoBash(apiKey, computerId, probeCommand, fetchImpl)

  if (probe.success) {
    return { installedNow: false, output: probe.output }
  }

  let installOutput = ''

  for (const command of buildOrgoAgentMcpInstallCommands(serverBytes.toString('base64'))) {
    const install = await runOrgoBash(apiKey, computerId, command, fetchImpl, 60)

    if (!install.success) {
      await runOrgoBash(
        apiKey,
        computerId,
        `rm -f ${ORGO_AGENT_MCP_STAGING_PATH}`,
        fetchImpl
      ).catch(() => undefined)

      throw new OrgoDesktopError(
        'unavailable',
        install.output.trim() || 'Could not install the Orgo agent tool.'
      )
    }

    installOutput = install.output || installOutput
  }

  const verify = await runOrgoBash(apiKey, computerId, probeCommand, fetchImpl)

  if (!verify.success) {
    throw new OrgoDesktopError('unavailable', 'The Orgo agent tool did not pass verification after upload.')
  }

  return { installedNow: true, output: verify.output || installOutput }
}

export function buildOrgoWallpaperApplyCommand(): string {
  return [
    'if command -v gsettings >/dev/null 2>&1; then',
    `  gsettings set org.gnome.desktop.background picture-uri 'file://${ORGO_SILK_WALLPAPER_PATH}'`,
    `  gsettings set org.gnome.desktop.background picture-uri-dark 'file://${ORGO_SILK_WALLPAPER_PATH}' 2>/dev/null || true`,
    "  gsettings set org.gnome.desktop.background picture-options 'scaled'",
    'fi',
    'if command -v xfconf-query >/dev/null 2>&1; then',
    "  xfconf-query -c xfce4-desktop -lv | awk '$1 ~ /(last-image|image-path)$/ {print $1}' | while read -r property; do",
    `    xfconf-query -c xfce4-desktop -p "$property" -s ${ORGO_SILK_WALLPAPER_PATH}`,
    '  done',
    '  command -v xfdesktop >/dev/null 2>&1 && xfdesktop --reload >/dev/null 2>&1 || true',
    'fi',
    'if command -v pcmanfm >/dev/null 2>&1; then',
    `  pcmanfm --set-wallpaper=${ORGO_SILK_WALLPAPER_PATH} --wallpaper-mode=fit >/dev/null 2>&1 || true`,
    'fi'
  ].join('\n')
}

export function buildOrgoWallpaperInstallCommands(base64Payload: string): string[] {
  const payload = String(base64Payload || '').replace(/\s/g, '')

  if (!payload) {
    throw new OrgoDesktopError('unavailable', 'The bundled Orgo desktop wallpaper is empty.')
  }

  const script = [
    'import base64, os, pathlib',
    `staging = pathlib.Path(${JSON.stringify(ORGO_WALLPAPER_STAGING_PATH)})`,
    'data = base64.b64decode(staging.read_text())',
    `targets = [${JSON.stringify(ORGO_SILK_WALLPAPER_PATH)}, ${JSON.stringify(ORGO_DEFAULT_WALLPAPER_PATH)}]`,
    '[pathlib.Path(target).parent.mkdir(parents=True, exist_ok=True) for target in targets]',
    '[(pathlib.Path(target).write_bytes(data), os.chmod(target, 0o644)) for target in targets]',
    'staging.unlink(missing_ok=True)'
  ].join('\n')

  const encodedScript = Buffer.from(script, 'utf8').toString('base64')
  const commands = [`umask 077; : > ${ORGO_WALLPAPER_STAGING_PATH}`]

  for (let offset = 0; offset < payload.length; offset += ORGO_WALLPAPER_UPLOAD_CHUNK_SIZE) {
    const chunk = payload.slice(offset, offset + ORGO_WALLPAPER_UPLOAD_CHUNK_SIZE)
    commands.push(`printf %s ${JSON.stringify(chunk)} >> ${ORGO_WALLPAPER_STAGING_PATH}`)
  }

  commands.push(`printf %s ${JSON.stringify(encodedScript)} | base64 -d | python3`)

  return commands
}

export function resolveOrgoWallpaperAssetPath(appRoot: string, resourcesPath = ''): string | null {
  for (const candidate of [
    resourcesPath ? path.join(resourcesPath, 'orgo', 'desktop-silk-wallpaper.png') : '',
    path.join(appRoot, 'electron', 'assets', 'desktop-silk-wallpaper.png')
  ]) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function readBundledOrgoWallpaperBytes(appRoot: string, resourcesPath = ''): Buffer {
  const assetPath = resolveOrgoWallpaperAssetPath(appRoot, resourcesPath)

  if (!assetPath) {
    throw new OrgoDesktopError('unavailable', 'Orgo desktop wallpaper asset is missing from the app bundle.')
  }

  return fs.readFileSync(assetPath)
}

/** Install the bundled silk wallpaper and point GNOME at it. Idempotent. */
export async function ensureOrgoDesktopWallpaper(
  apiKey: string,
  computerId: string,
  readWallpaperBytes: () => Buffer,
  fetchImpl: typeof fetch = fetch
): Promise<{ applied: boolean; installedNow: boolean; output: string }> {
  const probe = await runOrgoBash(apiKey, computerId, ORGO_WALLPAPER_PROBE_COMMAND, fetchImpl)

  if (probe.success) {
    const apply = await runOrgoBash(apiKey, computerId, buildOrgoWallpaperApplyCommand(), fetchImpl)

    if (!apply.success) {
      throw new OrgoDesktopError('unavailable', apply.output.trim() || 'Could not apply the Orgo desktop wallpaper.')
    }

    return { applied: true, installedNow: false, output: apply.output || probe.output }
  }

  let installOutput = ''

  for (const command of buildOrgoWallpaperInstallCommands(readWallpaperBytes().toString('base64'))) {
    const install = await runOrgoBash(apiKey, computerId, command, fetchImpl, 60)

    if (!install.success) {
      await runOrgoBash(
        apiKey,
        computerId,
        `rm -f ${ORGO_WALLPAPER_STAGING_PATH}`,
        fetchImpl
      ).catch(() => undefined)

      throw new OrgoDesktopError(
        'unavailable',
        install.output.trim() || 'Could not install the Orgo desktop wallpaper.'
      )
    }

    installOutput = install.output || installOutput
  }

  const apply = await runOrgoBash(apiKey, computerId, buildOrgoWallpaperApplyCommand(), fetchImpl)

  if (!apply.success) {
    throw new OrgoDesktopError('unavailable', apply.output.trim() || 'Could not apply the Orgo desktop wallpaper.')
  }

  const verify = await runOrgoBash(apiKey, computerId, ORGO_WALLPAPER_PROBE_COMMAND, fetchImpl)

  if (!verify.success) {
    throw new OrgoDesktopError('unavailable', 'The Orgo desktop wallpaper did not pass verification after upload.')
  }

  return { applied: true, installedNow: true, output: apply.output || verify.output || installOutput }
}

export async function doctorOrgoComputer(
  apiKey: string,
  computerId: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrgoDoctorResult> {
  const empty: OrgoDoctorResult = {
    ok: false,
    apiAuth: false,
    computerStatus: 'unknown',
    vncAvailable: false,
    mcpReady: false,
    hermesInstalled: false,
    message: 'Connect an Orgo computer first.'
  }

  if (!apiKey.trim()) {
    return empty
  }

  try {
    const computer = await ensureOrgoComputerRunning(apiKey, computerId, fetchImpl)
    let vncAvailable = false

    try {
      await fetchOrgoDesktopSession({ apiKey, computerId: computer.id }, fetchImpl)
      vncAvailable = true
    } catch {
      vncAvailable = false
    }

    const mcpReady = Boolean(computer.id && apiKey.trim())
    let hermesInstalled = false

    try {
      const probe = await runOrgoBash(apiKey, computer.id, HERMES_ORGO_PROBE_COMMAND, fetchImpl)
      hermesInstalled = probe.success || isHermesAgentTemplate(computer.templateRef)
    } catch {
      hermesInstalled = false
    }

    const ok = computer.status === 'running' && vncAvailable && mcpReady && hermesInstalled

    return {
      ok,
      apiAuth: true,
      computerStatus: computer.status,
      vncAvailable,
      mcpReady,
      hermesInstalled,
      message: ok
        ? 'Shared computer is ready with Hermes installed.'
        : hermesInstalled
          ? 'The computer is reachable but VNC or MCP is not ready yet.'
          : 'Orgo is up, but Hermes is not installed on the computer yet.'
    }
  } catch (error) {
    const serialized = serializeOrgoDesktopError(error)

    return {
      ...empty,
      apiAuth: serialized.code !== 'auth-failed',
      message: serialized.message,
      computerStatus: serialized.code === 'computer-not-found' ? 'missing' : 'error'
    }
  }
}

export function serializeOrgoBrokerError(error: unknown): { code: OrgoDesktopErrorCode; message: string } {
  return serializeOrgoDesktopError(error)
}
