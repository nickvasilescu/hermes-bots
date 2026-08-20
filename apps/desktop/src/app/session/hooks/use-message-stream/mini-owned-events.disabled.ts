interface MiniOwnedEventDeps {
  eventType: string
  isActiveEvent: boolean
  payload: Record<string, unknown> | null | undefined
  sessionId: null | string
  updateSessionState: (...args: never[]) => unknown
  upsertToolCall: (...args: never[]) => unknown
}

export function handleMiniOwnedGatewayEvent(_deps: MiniOwnedEventDeps): boolean {
  return false
}
