import type { IpcChannelPolicy, IpcChannelPrivilege, IpcChannelRule, IpcRegistrationKind } from './ipc-policy'
import type { WindowCapability } from './ipc-trust'

function rule(
  capabilities: readonly WindowCapability[],
  kind: IpcRegistrationKind,
  privilege: IpcChannelPrivilege
): IpcChannelRule {
  return Object.freeze({ capabilities: Object.freeze(capabilities), kind, privilege })
}

// This compile-time policy is deliberately self-contained. Importing the
// full-product inventory and filtering it at runtime would leave forbidden
// channel names in the packaged SSH-only artifact.
export const IPC_CHANNEL_POLICY = Object.freeze({
  'hermes:connection': rule(['primary', 'session', 'hud'], 'handle', 'gateway-runtime'),
  'hermes:connection:revalidate': rule(['primary', 'session', 'hud'], 'handle', 'gateway-runtime'),
  'hermes:backend:touch': rule(['primary', 'session', 'hud'], 'handle', 'gateway-runtime'),
  'hermes:api': rule(['primary', 'session', 'hud'], 'handle', 'gateway-api'),
  'hermes:gateway-proxy:start': rule(['primary', 'session', 'hud'], 'handle', 'gateway-runtime'),
  'hermes:gateway-proxy:send': rule(['primary', 'session', 'hud'], 'on', 'gateway-runtime'),
  'hermes:gateway-proxy:close': rule(['primary', 'session', 'hud'], 'on', 'gateway-runtime'),
  'hermes:boot-progress:get': rule(['primary'], 'handle', 'bootstrap'),
  'hermes:connection-config:get': rule(['primary'], 'handle', 'connection-config'),
  'hermes:connection-config:test': rule(['primary'], 'handle', 'connection-config'),
  'hermes:connection-config:save': rule(['primary'], 'handle', 'connection-config'),
  'hermes:connection-config:apply': rule(['primary'], 'handle', 'connection-config'),
  'hermes:profile:get': rule(['primary'], 'handle', 'profile-runtime'),
  'hermes:profile:set': rule(['primary'], 'handle', 'profile-runtime'),
  'hermes:requestMicrophoneAccess': rule(['primary'], 'handle', 'permission'),
  'hermes:deep-link-ready': rule(['primary'], 'handle', 'host-integration'),
  'hermes:notify': rule(['primary', 'session', 'hud'], 'handle', 'notification'),
  'hermes:window:openSession': rule(['primary'], 'handle', 'window-control'),
  'hermes:window:openInstance': rule(['primary'], 'handle', 'window-control'),
  'hermes:hud:open': rule(['primary', 'session'], 'handle', 'window-control'),
  'hermes:hud:close': rule(['primary', 'session', 'hud'], 'handle', 'window-control'),
  'hermes:hud:vibrancy': rule(['hud'], 'handle', 'window-control'),
  'hermes:hud:ignore-mouse': rule(['hud'], 'on', 'window-control'),
  'hermes:hud:move-by': rule(['hud'], 'on', 'window-control'),
  'hermes:hud:set-bounds': rule(['hud'], 'on', 'window-control'),
  'hermes:hud:session': rule(['hud'], 'on', 'window-control'),
  'hermes:quick-entry:settings:get': rule(['primary'], 'handle', 'host-integration'),
  'hermes:quick-entry:settings:set': rule(['primary'], 'handle', 'host-integration'),
  'hermes:quick-entry:submit': rule(['quick-entry'], 'on', 'renderer-safe'),
  'hermes:quick-entry:dismiss': rule(['quick-entry'], 'on', 'renderer-safe'),
  'hermes:quick-entry:state': rule(['primary'], 'on', 'renderer-safe'),
  'hermes:find-in-page': rule(['primary', 'session', 'hud'], 'handle', 'renderer-safe'),
  'hermes:stop-find-in-page': rule(['primary', 'session', 'hud'], 'handle', 'renderer-safe'),
  'hermes:zoom:get': rule(['primary', 'session', 'hud'], 'handle', 'renderer-safe'),
  'hermes:zoom:set-percent': rule(['primary', 'session', 'hud'], 'on', 'renderer-safe'),
  'hermes:active-work': rule(['primary', 'session', 'hud'], 'on', 'renderer-safe'),
  'hermes:power-battery:get': rule(
    ['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'],
    'handle',
    'renderer-safe'
  ),
  'hermes:version': rule(['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'], 'handle', 'renderer-safe'),
  'hermes:ambient:claim': rule(['primary', 'session', 'hud'], 'handle', 'renderer-safe'),
  'hermes:wake-indicator:get': rule(['primary'], 'handle', 'renderer-safe'),
  'hermes:wake-indicator:set': rule(['primary'], 'on', 'host-integration'),
  'hermes:translucency': rule(['primary'], 'on', 'host-integration'),
  'hermes:keep-awake': rule(['primary'], 'on', 'host-integration'),
  'hermes:titlebar-theme': rule(['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'], 'on', 'renderer-safe'),
  'hermes:native-theme': rule(['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'], 'on', 'renderer-safe'),
  'hermes:logs:renderer-error': rule(['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'], 'on', 'renderer-safe')
}) satisfies IpcChannelPolicy
