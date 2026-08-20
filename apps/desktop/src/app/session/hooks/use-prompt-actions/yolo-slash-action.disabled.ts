interface YoloSlashActionDeps {
  activeSessionIdRef: { current: null | string }
  appendSessionTextMessage: (...args: unknown[]) => void
  copy: unknown
  requestGateway: (...args: never[]) => Promise<unknown>
}

export function createYoloSlashActionHandler(
  _deps: YoloSlashActionDeps
): (_ctx: { sessionHint?: string }) => Promise<void> {
  return async () => undefined
}
