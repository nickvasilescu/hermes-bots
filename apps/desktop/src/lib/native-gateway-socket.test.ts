import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type GatewayProxyBridge,
  type GatewayProxyEvent,
  NativeGatewaySocket,
  openAuxiliaryGatewaySocket,
  resolveGatewayClientTarget
} from './native-gateway-socket'

function bridgeHarness() {
  let listener: ((event: GatewayProxyEvent) => void) | null = null

  const bridge: GatewayProxyBridge = {
    close: vi.fn(),
    onEvent: callback => {
      listener = callback

      return () => {
        listener = null
      }
    },
    send: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined)
  }

  return { bridge, emit: (event: GatewayProxyEvent) => listener?.(event) }
}

afterEach(() => vi.unstubAllGlobals())

describe('NativeGatewaySocket', () => {
  it('preserves open, message, send, and close ordering without a URL', async () => {
    const h = bridgeHarness()
    const socket = new NativeGatewaySocket(h.bridge, { profile: 'work', purpose: 'gateway' })
    const events: string[] = []
    socket.addEventListener('open', () => events.push('open'))
    socket.addEventListener('message', event => events.push(`message:${(event as MessageEvent).data}`))
    socket.addEventListener('close', () => events.push('close'))
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledWith({ id: socket.id, profile: 'work', purpose: 'gateway' }))

    h.emit({ id: socket.id, type: 'open' })
    h.emit({ data: 'frame', id: socket.id, type: 'message' })
    socket.send('request')
    h.emit({ code: 1000, id: socket.id, type: 'close' })

    expect(events).toEqual(['open', 'message:frame', 'close'])
    expect(h.bridge.send).toHaveBeenCalledWith(socket.id, 'request')
    expect(socket.url).toBe('')
  })

  it('normalizes transferred byte views to an ArrayBuffer', async () => {
    const h = bridgeHarness()
    const socket = new NativeGatewaySocket(h.bridge, { path: '/api/audio/speak-stream', purpose: 'voice' })
    let received: unknown
    socket.addEventListener('message', event => {
      received = (event as MessageEvent).data
    })
    h.emit({ id: socket.id, type: 'open' })
    h.emit({ data: new Uint8Array([1, 2, 3]), id: socket.id, type: 'message' })
    expect(received).toBeInstanceOf(ArrayBuffer)
  })
})

describe('gateway proxy selection', () => {
  it('does not request or expose a URL in proxy mode', async () => {
    const h = bridgeHarness()
    const getGatewayWsUrl = vi.fn()

    const target = await resolveGatewayClientTarget(
      { gatewayProxy: h.bridge, getGatewayWsUrl },
      { authMode: 'token', requireFreshWsUrl: true, useGatewayProxy: true },
      { profile: null, purpose: 'gateway' }
    )

    expect(target).toBeInstanceOf(NativeGatewaySocket)
    expect(getGatewayWsUrl).not.toHaveBeenCalled()
  })

  it('keeps the generic URL path for full products', async () => {
    class FakeWebSocket {
      constructor(readonly url: string) {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const socket = await openAuxiliaryGatewaySocket(
      { getGatewayWsUrl: vi.fn().mockResolvedValue('ws://host/api/ws?token=fresh') },
      { authMode: 'token', wsUrl: 'ws://host/api/ws?token=stale' },
      { path: '/api/plugins/kanban/events?board=one', purpose: 'plugin' }
    )

    expect((socket as unknown as FakeWebSocket).url).toContain('/api/plugins/kanban/events')
    expect((socket as unknown as FakeWebSocket).url).toContain('token=fresh')
    expect((socket as unknown as FakeWebSocket).url).toContain('board=one')
  })
})
