import { atom, computed } from 'nanostores'

export interface McpSetupRequest {
  requestId: string
  server: string
  action: 'authorize' | 'enable' | 'install'
  reason: string
  sessionId: string | null
}

export interface McpSetupOutcome {
  status: 'authorized' | 'declined' | 'enabled' | 'error' | 'installed'
  server: string
  detail?: string
  tools?: string[]
}

export const $mcpSetupRequests = atom<Record<string, McpSetupRequest>>({})

export const sessionMcpSetupRequest = (_sessionId: string | null) => computed($mcpSetupRequests, () => null)

export function setMcpSetupRequest(_request: McpSetupRequest): void {}

export function clearMcpSetupRequest(_requestId?: string, _sessionId?: string | null): void {}

export const hasMcpSetupRequest = (_sessionId: string | null | undefined): boolean => false

export async function skipMcpSetupRequest(_sessionId: string | null | undefined): Promise<boolean> {
  return false
}
