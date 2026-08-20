/** Provider credentials are owned by the remote Mini in the strict SSH SKU. */
export function DesktopOnboardingOverlay(_props: {
  enabled: boolean
  onCompleted?: () => void
  profile: string
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  return null
}
