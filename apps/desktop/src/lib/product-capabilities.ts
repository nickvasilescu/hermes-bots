import { DESKTOP_SKU, type DesktopSku } from './product'

export const DESKTOP_CONNECTION_MODES = ['local', 'remote', 'cloud', 'ssh'] as const
export type DesktopConnectionMode = (typeof DESKTOP_CONNECTION_MODES)[number]

export const DESKTOP_CAPABILITY_NAMES = [
  'allowLocalRuntime',
  'allowBootstrap',
  'allowOrgo',
  'allowComposio',
  'allowLocalCredentialEntry',
  'allowLinkTitleFetch',
  'allowPackagedCdp',
  'allowSandboxFallback'
] as const

export type DesktopCapabilityName = (typeof DESKTOP_CAPABILITY_NAMES)[number]
export type DesktopProductPolicy = Readonly<Record<DesktopCapabilityName, boolean>> & {
  readonly allowedConnectionModes: readonly DesktopConnectionMode[]
}

export const SSH_ONLY_POLICY: DesktopProductPolicy = Object.freeze({
  allowLocalRuntime: false,
  allowBootstrap: false,
  allowOrgo: false,
  allowComposio: false,
  allowLocalCredentialEntry: false,
  allowLinkTitleFetch: false,
  allowPackagedCdp: false,
  allowSandboxFallback: false,
  allowedConnectionModes: Object.freeze(['ssh'] as const)
})

export const FULL_DESKTOP_POLICY: DesktopProductPolicy = Object.freeze({
  allowLocalRuntime: true,
  allowBootstrap: true,
  allowOrgo: true,
  allowComposio: true,
  allowLocalCredentialEntry: true,
  allowLinkTitleFetch: true,
  allowPackagedCdp: true,
  allowSandboxFallback: true,
  allowedConnectionModes: Object.freeze([...DESKTOP_CONNECTION_MODES])
})

export function desktopCapabilitiesForSku(sku: DesktopSku): DesktopProductPolicy {
  return sku === 'bot-ssh-only' ? SSH_ONLY_POLICY : FULL_DESKTOP_POLICY
}

export const DESKTOP_PRODUCT_CAPABILITIES = desktopCapabilitiesForSku(DESKTOP_SKU)

export function allowsDesktopCapability(capability: DesktopCapabilityName): boolean {
  return DESKTOP_PRODUCT_CAPABILITIES[capability]
}

export function assertDesktopCapability(capability: DesktopCapabilityName): void {
  if (!allowsDesktopCapability(capability)) {
    throw new Error(`Capability ${capability} is forbidden by the ${DESKTOP_SKU} product policy`)
  }
}

export function isDesktopConnectionModeAllowed(mode: string): mode is DesktopConnectionMode {
  return DESKTOP_PRODUCT_CAPABILITIES.allowedConnectionModes.includes(mode as DesktopConnectionMode)
}

export function assertDesktopConnectionMode(mode: string): asserts mode is DesktopConnectionMode {
  if (!isDesktopConnectionModeAllowed(mode)) {
    throw new Error(`Connection mode ${JSON.stringify(mode)} is forbidden by the ${DESKTOP_SKU} product policy`)
  }
}
