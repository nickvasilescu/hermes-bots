import path from 'node:path'

export const HERMES_APP_NAME = 'Hermes'
export const HERMES_APP_ID = 'com.nousresearch.hermes'

export const BOT_APP_NAME = 'Korgo Bot'
// Keep the installed identity and data directory stable across the rebrand so
// existing users retain their app permissions, credentials, and local state.
export const BOT_APP_ID = 'com.nousresearch.hermes-bots'
export const BOT_USER_DATA_DIRNAME = 'Hermes Bots'
export const BOT_TEMPLATE_REF = 'system/hermes-agent@1.0.0'
export const BOT_UPDATE_POLICY = 'source-release' as const

export type DesktopProduct = 'bot' | 'hermes'
export type DesktopSku = DesktopProduct | 'bot-ssh-only'

function resolveDesktopSku(sku: string | undefined, product: string | undefined): DesktopSku {
  if (sku === 'bot-ssh-only') {
    return 'bot-ssh-only'
  }

  return product === 'bot' || sku === 'bot' ? 'bot' : 'hermes'
}

/**
 * Captured once at module initialization. Production esbuild replaces the
 * environment reads with string literals, so launch-time environment changes
 * cannot widen a packaged SKU's product policy.
 */
export const DESKTOP_SKU: DesktopSku = resolveDesktopSku(
  process.env.HERMES_DESKTOP_SKU,
  process.env.HERMES_DESKTOP_PRODUCT
)

export function desktopSku(): DesktopSku {
  return DESKTOP_SKU
}

export function desktopProduct(): DesktopProduct {
  return DESKTOP_SKU === 'hermes' ? 'hermes' : 'bot'
}

export function isBotProduct(): boolean {
  return desktopProduct() === 'bot'
}

export function isSshOnlyProduct(): boolean {
  return DESKTOP_SKU === 'bot-ssh-only'
}

/** Bot releases pin their remote template and move client/backend together.
 * Generic Hermes update flows would bypass that compatibility guarantee. */
export function allowsGenericHermesUpdates(): boolean {
  return !isBotProduct()
}

export function desktopAppName(): string {
  return process.env.HERMES_DESKTOP_APP_NAME || (isBotProduct() ? BOT_APP_NAME : HERMES_APP_NAME)
}

export function desktopAppId(): string {
  return isBotProduct() ? BOT_APP_ID : HERMES_APP_ID
}

/** Pin the app name (and therefore the default userData folder) before any
 *  `app.getPath('userData')` call. Must run at module load. */
export function applyDesktopProductIdentity(app: {
  setName: (name: string) => void
  setPath: (name: 'userData', value: string) => void
  getPath: (name: 'userData') => string
}): void {
  if (!isBotProduct()) {
    return
  }

  app.setName(desktopAppName())

  if (process.env.HERMES_DESKTOP_USER_DATA_DIR) {
    return
  }

  const current = app.getPath('userData')
  const target = path.join(path.dirname(current), BOT_USER_DATA_DIRNAME)

  if (current !== target) {
    app.setPath('userData', target)
  }
}
