import {
  type IpcEventLike,
  type IpcSenderIdentity,
  type IpcTrustRegistry,
  UntrustedIpcSenderError,
  type WindowCapability
} from './ipc-trust'

export const ERR_UNCLASSIFIED_IPC_CHANNEL = 'ERR_UNCLASSIFIED_IPC_CHANNEL'
export const ERR_IPC_REGISTRATION_KIND = 'ERR_IPC_REGISTRATION_KIND'
export const ERR_DUPLICATE_IPC_REGISTRATION = 'ERR_DUPLICATE_IPC_REGISTRATION'
export const ERR_INCOMPLETE_IPC_REGISTRATION = 'ERR_INCOMPLETE_IPC_REGISTRATION'

export type IpcRegistrationKind = 'handle' | 'on'

export type IpcChannelPrivilege =
  | 'bootstrap'
  | 'clipboard'
  | 'connection-config'
  | 'connector-credentials'
  | 'external-open'
  | 'filesystem'
  | 'gateway-api'
  | 'gateway-runtime'
  | 'git'
  | 'host-integration'
  | 'notification'
  | 'permission'
  | 'profile-runtime'
  | 'renderer-safe'
  | 'terminal'
  | 'uninstall'
  | 'update'
  | 'window-control'

export interface IpcChannelRule {
  capabilities: readonly WindowCapability[]
  kind: IpcRegistrationKind
  privilege: IpcChannelPrivilege
}

type LegacyIpcChannelRule = readonly WindowCapability[]

export type IpcChannelPolicy = Readonly<Record<string, IpcChannelRule | LegacyIpcChannelRule>>

export interface IpcRegistrationSnapshot {
  channel: string
  kind: IpcRegistrationKind
}

interface IpcMainLike {
  handle: (channel: string, listener: (event: any, ...args: any[]) => unknown) => void
  on: (channel: string, listener: (event: any, ...args: any[]) => unknown) => void
}

export interface AuthorizedIpcOptions {
  ipcMain: IpcMainLike
  isTrustedRendererUrl: (url: string) => boolean
  onDenied?: (metadata: { channel: string; senderId: number | null }) => void
  policy: IpcChannelPolicy
  registry: IpcTrustRegistry
}

export interface AuthorizedIpc {
  assertComplete: () => void
  handle: (channel: string, listener: (event: any, ...args: any[]) => unknown) => void
  on: (channel: string, listener: (event: any, ...args: any[]) => unknown) => void
  registrationSnapshot: () => readonly IpcRegistrationSnapshot[]
}

function channelRule(policy: IpcChannelPolicy, channel: string): IpcChannelRule | null {
  const entry = policy[channel]

  if (!entry) {
    return null
  }

  if (Array.isArray(entry)) {
    return { capabilities: entry, kind: 'handle', privilege: 'renderer-safe' }
  }

  return entry as IpcChannelRule
}

function authorize(
  event: IpcEventLike,
  channel: string,
  { isTrustedRendererUrl, onDenied, policy, registry }: Omit<AuthorizedIpcOptions, 'ipcMain'>
): IpcSenderIdentity {
  const identity = registry.identify(event, isTrustedRendererUrl)
  const rule = channelRule(policy, channel)
  const allowed = identity && rule?.capabilities.includes(identity.capability)

  if (!identity || !allowed) {
    onDenied?.({ channel, senderId: identity?.senderId ?? null })
    throw new UntrustedIpcSenderError(channel)
  }

  return identity
}

export function createAuthorizedIpc(options: AuthorizedIpcOptions): AuthorizedIpc {
  const common = {
    isTrustedRendererUrl: options.isTrustedRendererUrl,
    onDenied: options.onDenied,
    policy: options.policy,
    registry: options.registry
  }

  const registrations = new Map<string, IpcRegistrationKind>()

  const register = (
    kind: IpcRegistrationKind,
    channel: string,
    listener: (event: any, ...args: any[]) => unknown
  ): void => {
    const entry = options.policy[channel]

    if (!entry) {
      throw new Error(`${ERR_UNCLASSIFIED_IPC_CHANNEL}: ${channel}`)
    }

    const rule = channelRule(options.policy, channel)

    if (!Array.isArray(entry) && rule?.kind !== kind) {
      throw new Error(`${ERR_IPC_REGISTRATION_KIND}: ${channel} is ${rule?.kind}, not ${kind}`)
    }

    if (registrations.has(channel)) {
      throw new Error(`${ERR_DUPLICATE_IPC_REGISTRATION}: ${channel}`)
    }

    options.ipcMain[kind](channel, (event, ...args) => {
      authorize(event, channel, common)

      return listener(event, ...args)
    })
    registrations.set(channel, kind)
  }

  return {
    assertComplete(): void {
      const missing = Object.keys(options.policy).filter(channel => !registrations.has(channel))

      if (missing.length > 0) {
        throw new Error(`${ERR_INCOMPLETE_IPC_REGISTRATION}: ${missing.sort().join(', ')}`)
      }
    },
    handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void {
      register('handle', channel, listener)
    },
    on(channel: string, listener: (event: any, ...args: any[]) => unknown): void {
      register('on', channel, listener)
    },
    registrationSnapshot(): readonly IpcRegistrationSnapshot[] {
      return Object.freeze([...registrations].map(([channel, kind]) => Object.freeze({ channel, kind })))
    }
  }
}
