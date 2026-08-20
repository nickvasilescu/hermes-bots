export const ERR_UNTRUSTED_IPC_SENDER = 'ERR_UNTRUSTED_IPC_SENDER'

export type WindowCapability = 'hud' | 'pet-overlay' | 'primary' | 'quick-entry' | 'session'

interface FrameLike {
  top?: unknown
  url?: string
}

interface WebContentsLike {
  id?: number
  isDestroyed?: () => boolean
  mainFrame?: unknown
}

interface RegisteredWebContents {
  capability: WindowCapability
  token: symbol
}

export interface IpcEventLike {
  sender?: WebContentsLike
  senderFrame?: FrameLike | null
}

export interface IpcSenderIdentity {
  capability: WindowCapability
  senderId: number | null
}

export class IpcTrustRegistry {
  readonly #contents = new Map<WebContentsLike, RegisteredWebContents>()

  register(contents: WebContentsLike, capability: WindowCapability): () => void {
    const registration = { capability, token: Symbol(capability) }
    this.#contents.set(contents, registration)

    return () => {
      if (this.#contents.get(contents)?.token === registration.token) {
        this.#contents.delete(contents)
      }
    }
  }

  unregister(contents: WebContentsLike): void {
    this.#contents.delete(contents)
  }

  isRegistered(contents: WebContentsLike): boolean {
    return this.#contents.has(contents) && !contents.isDestroyed?.()
  }

  identify(event: IpcEventLike, isTrustedRendererUrl: (url: string) => boolean): IpcSenderIdentity | null {
    const sender = event.sender
    const frame = event.senderFrame

    if (!sender || !frame || sender.isDestroyed?.()) {
      return null
    }

    const registration = this.#contents.get(sender)

    if (!registration || frame.top !== frame || frame !== sender.mainFrame || !isTrustedRendererUrl(frame.url ?? '')) {
      return null
    }

    return { capability: registration.capability, senderId: typeof sender.id === 'number' ? sender.id : null }
  }
}

export class UntrustedIpcSenderError extends Error {
  readonly code = ERR_UNTRUSTED_IPC_SENDER

  constructor(channel: string) {
    super(`${ERR_UNTRUSTED_IPC_SENDER}: ${channel}`)
    this.name = 'UntrustedIpcSenderError'
  }
}
