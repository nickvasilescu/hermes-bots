import {
  IpcTrustRegistry,
  type IpcEventLike,
  type IpcSenderIdentity,
  UntrustedIpcSenderError,
  type WindowCapability
} from './ipc-trust'

export type IpcChannelPolicy = Readonly<Record<string, readonly WindowCapability[]>>

interface IpcMainLike {
  handle: (channel: string, listener: (event: IpcEventLike, ...args: any[]) => unknown) => void
  on: (channel: string, listener: (event: IpcEventLike, ...args: any[]) => unknown) => void
}

interface AuthorizedIpcOptions {
  ipcMain: IpcMainLike
  isTrustedRendererUrl: (url: string) => boolean
  onDenied?: (metadata: { channel: string; senderId: number | null }) => void
  policy: IpcChannelPolicy
  registry: IpcTrustRegistry
}

function authorize(
  event: IpcEventLike,
  channel: string,
  { isTrustedRendererUrl, onDenied, policy, registry }: Omit<AuthorizedIpcOptions, 'ipcMain'>
): IpcSenderIdentity {
  const identity = registry.identify(event, isTrustedRendererUrl)
  const allowed = identity && policy[channel]?.includes(identity.capability)

  if (!identity || !allowed) {
    onDenied?.({ channel, senderId: identity?.senderId ?? null })
    throw new UntrustedIpcSenderError(channel)
  }

  return identity
}

export function createAuthorizedIpc(options: AuthorizedIpcOptions) {
  const common = {
    isTrustedRendererUrl: options.isTrustedRendererUrl,
    onDenied: options.onDenied,
    policy: options.policy,
    registry: options.registry
  }

  return {
    handle(channel: string, listener: (event: IpcEventLike, ...args: any[]) => unknown): void {
      if (!options.policy[channel]) {
        throw new Error(`Unclassified IPC channel: ${channel}`)
      }

      options.ipcMain.handle(channel, (event, ...args) => {
        authorize(event, channel, common)

        return listener(event, ...args)
      })
    },
    on(channel: string, listener: (event: IpcEventLike, ...args: any[]) => unknown): void {
      if (!options.policy[channel]) {
        throw new Error(`Unclassified IPC channel: ${channel}`)
      }

      options.ipcMain.on(channel, (event, ...args) => {
        authorize(event, channel, common)

        return listener(event, ...args)
      })
    }
  }
}
