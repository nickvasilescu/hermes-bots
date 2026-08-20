export const BOT_PROVIDER_SETUP_READY_EVENT = 'hermes-bots:provider-setup-ready'

export function isBotProviderSetupReady(): boolean {
  return true
}

export function markBotProviderSetupComplete(): void {}

export function BotSetupOverlay(_props: {
  enabled: boolean
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  return null
}
