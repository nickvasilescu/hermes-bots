import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'

const EVENT_CHANNEL = 'hermes:gateway-proxy:event'
const START_CHANNEL = 'hermes:gateway-proxy:start'
const SEND_CHANNEL = 'hermes:gateway-proxy:send'
const CLOSE_CHANNEL = 'hermes:gateway-proxy:close'
const MAX_SOCKETS_PER_RENDERER = 16
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024
const ID_RE = /^[a-zA-Z0-9-]{8,128}$/

export type GatewayProxyPurpose = 'gateway' | 'plugin' | 'voice'

export interface GatewayProxyRequest {
  id: string
  path?: string
  profile?: null | string
  purpose: GatewayProxyPurpose
}

interface IpcRegistrar {
  handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void
  on: (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => unknown) => void
}

interface SocketLike {
  binaryType: string
  bufferedAmount: number
  close: (code?: number, reason?: string) => void
  send: (data: unknown) => void
  addEventListener: (type: string, listener: (event: any) => void) => void
}

interface ProxyEntry {
  owner: WebContents
  socket: SocketLike
  messageChain: Promise<void>
}

export interface GatewayProxyOptions {
  createSocket?: (url: string) => SocketLike
  ipc: IpcRegistrar
  resolveUrl: (profile: null | string) => Promise<string>
}

function normalizedProfile(profile: unknown): null | string {
  if (profile === null || profile === undefined || profile === '') return null
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
    throw new Error('Invalid gateway proxy profile.')
  }
  return profile
}

function targetUrl(rawUrl: string, request: GatewayProxyRequest): string {
  const url = new URL(rawUrl)
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
    url.username ||
    url.password ||
    url.pathname !== '/api/ws'
  ) {
    throw new Error('Native gateway resolver returned an invalid endpoint.')
  }

  if (request.purpose === 'gateway') return url.toString()

  if (request.purpose === 'voice') {
    if (request.path !== '/api/audio/speak-stream') throw new Error('Invalid voice proxy endpoint.')
    url.pathname = url.pathname.replace(/\/api\/ws$/, request.path)
  } else {
    const path = String(request.path || '')
    const rawPathname = path.split('?')[0]
    let decodedPathname = ''
    try {
      decodedPathname = decodeURIComponent(rawPathname)
    } catch {
      throw new Error('Invalid plugin proxy endpoint.')
    }
    const segments = decodedPathname.split('/')
    const invalidPath =
      path.includes('#') ||
      /[\s\\]/.test(path) ||
      /%(?:2f|5c)/i.test(path) ||
      segments[0] !== '' ||
      segments[1] !== 'api' ||
      segments[2] !== 'plugins' ||
      !/^[a-zA-Z0-9._~-]+$/.test(segments[3] || '') ||
      segments.length < 5 ||
      segments.slice(4).some(segment => segment === '.' || segment === '..')
    if (invalidPath) {
      throw new Error('Invalid plugin proxy endpoint.')
    }
    const requested = new URL(path, 'http://gateway.invalid')
    for (const name of requested.searchParams.keys()) {
      if (/^(?:access_token|authorization|profile|ticket|token)$/i.test(name)) {
        throw new Error('Invalid plugin proxy endpoint.')
      }
    }
    url.pathname = url.pathname.replace(/\/api\/ws$/, requested.pathname)
    requested.searchParams.forEach((value, name) => url.searchParams.set(name, value))
  }

  const profile = normalizedProfile(request.profile)
  if (profile) url.searchParams.set('profile', profile)
  return url.toString()
}

async function transferableData(data: unknown): Promise<unknown> {
  if (typeof data === 'string' || data instanceof ArrayBuffer || data instanceof Uint8Array) return data
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer()
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return String(data)
}

export function registerGatewayProxy(options: GatewayProxyOptions): { disposeOwner: (owner: WebContents) => void } {
  const entries = new Map<string, ProxyEntry>()
  const createSocket = options.createSocket ?? (url => new WebSocket(url) as unknown as SocketLike)
  const entryKey = (owner: WebContents, id: string) => `${owner.id}:${id}`
  const emit = (entry: ProxyEntry, payload: Record<string, unknown>) => {
    if (!entry.owner.isDestroyed()) entry.owner.send(EVENT_CHANNEL, payload)
  }
  const closeEntry = (key: string, code = 1000, reason = 'closed') => {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    try {
      entry.socket.close(code, reason)
    } catch {
      // Socket may already be closed.
    }
  }

  options.ipc.handle(START_CHANNEL, async (event, rawRequest) => {
    const request = rawRequest as GatewayProxyRequest
    if (!request || !ID_RE.test(String(request.id || ''))) throw new Error('Invalid gateway proxy id.')
    if (!['gateway', 'plugin', 'voice'].includes(request.purpose)) throw new Error('Invalid gateway proxy purpose.')
    const key = entryKey(event.sender, request.id)
    if (entries.has(key)) throw new Error('Gateway proxy id is already active.')

    const ownerCount = [...entries.values()].filter(entry => entry.owner === event.sender).length
    if (ownerCount >= MAX_SOCKETS_PER_RENDERER) throw new Error('Gateway proxy socket limit reached.')

    const profile = normalizedProfile(request.profile)
    const url = targetUrl(await options.resolveUrl(profile), { ...request, profile })
    let socket: SocketLike
    try {
      socket = createSocket(url)
    } catch {
      throw new Error('Gateway proxy could not open socket.')
    }
    socket.binaryType = 'arraybuffer'
    const entry: ProxyEntry = { owner: event.sender, socket, messageChain: Promise.resolve() }
    entries.set(key, entry)

    socket.addEventListener('open', () => emit(entry, { id: request.id, type: 'open' }))
    socket.addEventListener('message', message => {
      entry.messageChain = entry.messageChain.then(async () => {
        if (entries.get(key) !== entry) return
        emit(entry, { data: await transferableData(message.data), id: request.id, type: 'message' })
      })
    })
    socket.addEventListener('error', () => emit(entry, { id: request.id, type: 'error' }))
    socket.addEventListener('close', closeEvent => {
      if (entries.get(key) === entry) entries.delete(key)
      emit(entry, {
        code: Number(closeEvent.code) || 1000,
        id: request.id,
        reason: String(closeEvent.reason || '')
          .replace(/([?&](?:access_token|ticket|token)=)[^&\s]+/gi, '$1[redacted]')
          .slice(0, 256),
        type: 'close'
      })
    })

    return { ok: true }
  })

  options.ipc.on(SEND_CHANNEL, (event, raw) => {
    const id = String(raw?.id || '')
    const key = entryKey(event.sender, id)
    const entry = entries.get(key)
    if (!entry) return
    if (entry.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      emit(entry, { id, type: 'error' })
      closeEntry(key, 1009, 'proxy backpressure limit')
      return
    }
    entry.socket.send(raw?.data)
  })

  options.ipc.on(CLOSE_CHANNEL, (event, raw) => {
    const id = String(raw?.id || '')
    closeEntry(entryKey(event.sender, id))
  })

  return {
    disposeOwner(owner) {
      for (const [id, entry] of entries) {
        if (entry.owner === owner) closeEntry(id, 1001, 'renderer destroyed')
      }
    }
  }
}

export const GATEWAY_PROXY_CHANNELS = Object.freeze({
  close: CLOSE_CHANNEL,
  event: EVENT_CHANNEL,
  send: SEND_CHANNEL,
  start: START_CHANNEL
})
