export interface NativeTokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number
  provider: string
  userId: string
}

export const nativeRefreshUrl = undefined as never
export const parseTokenResponse = undefined as never
export const resolveLoginStrategy = undefined as never
export const tokenNeedsRefresh = undefined as never
