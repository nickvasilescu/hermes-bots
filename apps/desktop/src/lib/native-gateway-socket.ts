import { resolveGatewayWsUrl, type GatewayWsConnection, type ResolveGatewayWsUrlDeps } from '@hermes/shared'

export type GatewayProxyPurpose = 'gateway' | 'plugin' | 'voice'

export interface GatewayProxyTarget {
  path?: string
  profile?: null | string
  purpose: GatewayProxyPurpose
}

export interface GatewayProxyEvent {
  code?: number
  data?: unknown
  id: string
  reason?: string
  type: 'close' | 'error' | 'message' | 'open'
}

export interface GatewayProxyBridge {
  close: (id: string) => void
  onEvent: (callback: (event: GatewayProxyEvent) => void) => () => void
  send: (id: string, data: ArrayBuffer | string | Uint8Array) => void
  start: (request: GatewayProxyTarget & { id: string }) => Promise<void>
}

export interface GatewayTransportDeps extends ResolveGatewayWsUrlDeps {
  gatewayProxy?: GatewayProxyBridge
}

type SocketListener = EventListenerOrEventListenerObject

function eventFor(type: string, init: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type), init)
}

function normalizeMessageData(data: unknown): unknown {
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }

  return data
}

export class NativeGatewaySocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = NativeGatewaySocket.CONNECTING
  readonly OPEN = NativeGatewaySocket.OPEN
  readonly CLOSING = NativeGatewaySocket.CLOSING
  readonly CLOSED = NativeGatewaySocket.CLOSED
  readonly id: string
  readonly url = ''
  readonly protocol = ''
  readonly extensions = ''
  bufferedAmount = 0
  binaryType: BinaryType = 'arraybuffer'
  readyState = NativeGatewaySocket.CONNECTING
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null
  onerror: ((this: WebSocket, ev: Event) => any) | null = null
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null
  onopen: ((this: WebSocket, ev: Event) => any) | null = null

  readonly #bridge: GatewayProxyBridge
  readonly #listeners = new Map<string, Set<SocketListener>>()
  #unsubscribe: (() => void) | null

  constructor(bridge: GatewayProxyBridge, target: GatewayProxyTarget) {
    this.#bridge = bridge
    this.id = globalThis.crypto?.randomUUID?.() ?? `gateway-${Date.now()}-${Math.random().toString(16).slice(2)}`
    this.#unsubscribe = bridge.onEvent(event => {
      if (event.id === this.id) this.#receive(event)
    })

    queueMicrotask(() => {
      void bridge.start({ ...target, id: this.id }).catch(error => {
        this.#dispatch('error', eventFor('error', { error }))
        this.#finishClose(1011, error instanceof Error ? error.message : String(error))
      })
    })
  }

  addEventListener(type: string, callback: SocketListener | null): void {
    if (!callback) return
    const listeners = this.#listeners.get(type) ?? new Set<SocketListener>()
    listeners.add(callback)
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type: string, callback: SocketListener | null): void {
    if (callback) this.#listeners.get(type)?.delete(callback)
  }

  dispatchEvent(event: Event): boolean {
    this.#dispatch(event.type, event)
    return !event.defaultPrevented
  }

  send(data: ArrayBuffer | ArrayBufferView | Blob | string): void {
    if (this.readyState !== NativeGatewaySocket.OPEN) {
      throw new DOMException('Native gateway transport is not open.', 'InvalidStateError')
    }

    if (data instanceof Blob) {
      void data.arrayBuffer().then(buffer => this.#bridge.send(this.id, buffer))
      return
    }

    if (ArrayBuffer.isView(data)) {
      this.#bridge.send(this.id, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      return
    }

    this.#bridge.send(this.id, data)
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === NativeGatewaySocket.CLOSED || this.readyState === NativeGatewaySocket.CLOSING) return
    this.readyState = NativeGatewaySocket.CLOSING
    this.#bridge.close(this.id)
  }

  #receive(event: GatewayProxyEvent): void {
    if (event.type === 'open') {
      if (this.readyState !== NativeGatewaySocket.CONNECTING) return
      this.readyState = NativeGatewaySocket.OPEN
      this.#dispatch('open', eventFor('open'))
      return
    }

    if (event.type === 'message' && this.readyState === NativeGatewaySocket.OPEN) {
      this.#dispatch('message', eventFor('message', { data: normalizeMessageData(event.data) }))
      return
    }

    if (event.type === 'error') {
      this.#dispatch('error', eventFor('error'))
      return
    }

    if (event.type === 'close') this.#finishClose(event.code ?? 1000, event.reason ?? '')
  }

  #finishClose(code: number, reason: string): void {
    if (this.readyState === NativeGatewaySocket.CLOSED) return
    this.readyState = NativeGatewaySocket.CLOSED
    this.#dispatch('close', eventFor('close', { code, reason, wasClean: code === 1000 }))
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  #dispatch(type: string, event: Event): void {
    const property = this[`on${type}` as 'onclose'] as ((event: Event) => void) | null
    property?.call(this as unknown as WebSocket, event)

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener.call(this as unknown as WebSocket, event)
      else listener.handleEvent(event)
    }
  }
}

function rewriteGatewayUrl(rawUrl: string, target: GatewayProxyTarget): string {
  if (target.purpose === 'gateway') return rawUrl

  const url = new URL(rawUrl)
  if (!url.pathname.endsWith('/api/ws')) throw new Error('Gateway WebSocket URL has an unexpected endpoint.')
  const targetUrl = new URL(target.path ?? '', 'http://gateway.invalid')
  url.pathname = url.pathname.replace(/\/api\/ws$/, targetUrl.pathname)
  targetUrl.searchParams.forEach((value, name) => url.searchParams.set(name, value))
  if (target.profile) url.searchParams.set('profile', target.profile)
  return url.toString()
}

export async function resolveGatewayClientTarget(
  deps: GatewayTransportDeps,
  connection: GatewayWsConnection & { useGatewayProxy?: boolean },
  target: GatewayProxyTarget
): Promise<string | WebSocket> {
  if (connection.useGatewayProxy) {
    if (!deps.gatewayProxy) throw new Error('Native gateway proxy is required but unavailable.')
    return new NativeGatewaySocket(deps.gatewayProxy, target) as unknown as WebSocket
  }

  return rewriteGatewayUrl(await resolveGatewayWsUrl(deps, connection), target)
}

export async function openAuxiliaryGatewaySocket(
  deps: GatewayTransportDeps,
  connection: GatewayWsConnection & { useGatewayProxy?: boolean },
  target: GatewayProxyTarget
): Promise<WebSocket> {
  const resolved = await resolveGatewayClientTarget(deps, connection, target)
  return typeof resolved === 'string' ? new WebSocket(resolved) : resolved
}
