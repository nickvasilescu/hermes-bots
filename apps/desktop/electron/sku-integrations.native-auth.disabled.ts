export const oauthGuardMayHardFail = undefined as never
export const oauthSessionIsLive = undefined as never

export function resolveJsonBody<T>(body: T): T {
  return body
}

export const resolveOauthRestAuth = undefined as never

export function resolveReadinessProbeAuth(
  authMode: string | null | undefined,
  _nativeAccessToken?: string | null,
  connectionToken?: string | null
) {
  return authMode === 'token' ? { kind: 'token', token: connectionToken ?? null } : { kind: 'public' }
}
