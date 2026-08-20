export const DESKTOP_CONNECTION_MODES = ['local', 'remote', 'cloud', 'ssh'] as const

export type DesktopConnectionMode = (typeof DESKTOP_CONNECTION_MODES)[number]

export const SSH_ONLY_CAPABILITY_NAMES = [
  'allowLocalRuntime',
  'allowBootstrap',
  'allowOrgo',
  'allowComposio',
  'allowLocalCredentialEntry',
  'allowLinkTitleFetch',
  'allowPackagedCdp',
  'allowSandboxFallback'
] as const

export type SshOnlyCapabilityName = (typeof SSH_ONLY_CAPABILITY_NAMES)[number]

export type DesktopProductPolicy = Readonly<Record<SshOnlyCapabilityName, boolean>> & {
  readonly allowedConnectionModes: readonly DesktopConnectionMode[]
}

export const SSH_ONLY_IDENTITY_PATH = '/run/korgo-ssh/identity'
export const SSH_ONLY_KNOWN_HOSTS_PATH = '/run/korgo-ssh/known_hosts'

export const SSH_ONLY_HOST_KEY_POLICY = Object.freeze({
  strictHostKeyChecking: 'yes' as const,
  userKnownHostsFile: SSH_ONLY_KNOWN_HOSTS_PATH,
  globalKnownHostsFile: '/dev/null' as const,
  updateHostKeys: 'no' as const
})

/** Security boundary for the compile-time bot-ssh-only SKU. */
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

export function isSshOnlyConnectionMode(mode: string): mode is 'ssh' {
  return mode === 'ssh'
}

export function assertSshOnlyConnectionMode(mode: string): asserts mode is 'ssh' {
  if (!isSshOnlyConnectionMode(mode)) {
    throw new Error(`Connection mode ${JSON.stringify(mode)} is forbidden by the bot-ssh-only product policy`)
  }
}
