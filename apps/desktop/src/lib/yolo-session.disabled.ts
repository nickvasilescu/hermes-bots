export type GatewayRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

export async function setSessionYolo(
  _requestGateway: GatewayRequester,
  _sessionId: string,
  _enabled: boolean
): Promise<boolean> {
  return false
}

export async function setGlobalYolo(_requestGateway: GatewayRequester, _enabled: boolean): Promise<boolean> {
  return false
}

export async function setYoloEnabled(_enabled: boolean): Promise<boolean> {
  return false
}
