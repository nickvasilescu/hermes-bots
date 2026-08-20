import { DESKTOP_SKU, type DesktopSku } from './product'
import {
  DESKTOP_CONNECTION_MODES,
  type DesktopConnectionMode,
  type DesktopProductPolicy,
  SSH_ONLY_POLICY,
  type SshOnlyCapabilityName
} from './ssh-only-policy'

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

export function allowsDesktopCapability(capability: SshOnlyCapabilityName): boolean {
  return DESKTOP_PRODUCT_CAPABILITIES[capability]
}

export function assertDesktopCapability(capability: SshOnlyCapabilityName): void {
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
