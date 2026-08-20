import { expect, test } from '@playwright/test'

import { GATEWAY_PROXY_CHANNELS, registerGatewayProxy } from '../electron/gateway-proxy'
import { NativeGatewaySocket, type GatewayProxyBridge, type GatewayProxyEvent } from '../src/lib/native-gateway-socket'
import { writeSshOnlyEvidence } from './ssh-only-packaged-fixtures'

type Listener = (event: unknown, payload: any) => unknown

class FakeIpc {
  readonly handles = new Map<string, Listener>()
  readonly listeners = new Map<string, Listener>()

  handle(channel: string, listener: Listener): void {
    this.handles.set(channel, listener)
  }

  on(channel: string, listener: Listener): void {
    this.listeners.set(channel, listener)
  }
}

class FakeOwner {
  static nextId = 1

  destroyed = false
  readonly events: GatewayProxyEvent[] = []
  readonly id = FakeOwner.nextId++
  eventListener: ((event: GatewayProxyEvent) => void) | null = null

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: GatewayProxyEvent): void {
    expect(channel).toBe(GATEWAY_PROXY_CHANNELS.event)
    this.events.push(payload)
    this.eventListener?.(payload)
  }
}

class FakeMainSocket {
  binaryType = ''
  bufferedAmount = 0
  readonly closeCalls: Array<{ code?: number; reason?: string }> = []
  readonly listeners = new Map<string, Array<(event: any) => void>>()
  readonly sent: unknown[] = []

  constructor(readonly resolvedUrl: string) {}

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  send(data: unknown): void {
    this.sent.push(data)
  }
}

interface Harness {
  bridgeFor: (owner: FakeOwner) => GatewayProxyBridge
  disposeOwner: (owner: FakeOwner) => void
  owners: FakeOwner[]
  profiles: Array<null | string>
  sockets: FakeMainSocket[]
}

function createHarness(): Harness {
  const ipc = new FakeIpc()
  const sockets: FakeMainSocket[] = []
  const profiles: Array<null | string> = []
  const owners: FakeOwner[] = []
  const registration = registerGatewayProxy({
    createSocket: url => {
      const socket = new FakeMainSocket(url)
      sockets.push(socket)

      return socket
    },
    ipc: ipc as never,
    resolveUrl: async profile => {
      profiles.push(profile)

      return `ws://127.0.0.1:51999/api/ws?token=KORGO_E2E_SENTINEL_CREDENTIAL&profile=${profile ?? 'default'}`
    }
  })

  return {
    bridgeFor(owner) {
      owners.push(owner)

      return {
        close(id) {
          ipc.listeners.get(GATEWAY_PROXY_CHANNELS.close)?.({ sender: owner }, { id })
        },
        onEvent(callback) {
          owner.eventListener = callback

          return () => {
            if (owner.eventListener === callback) owner.eventListener = null
          }
        },
        send(id, data) {
          ipc.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.({ sender: owner }, { data, id })
        },
        async start(request) {
          await ipc.handles.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: owner }, request)
        }
      }
    },
    disposeOwner: owner => registration.disposeOwner(owner as never),
    owners,
    profiles,
    sockets
  }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

test.describe('main-process gateway proxy parity with dummy transports', () => {
  test('preserves ordered text/binary frames and keeps credentials out of the renderer', async () => {
    const harness = createHarness()
    const owner = new FakeOwner()
    const socket = new NativeGatewaySocket(harness.bridgeFor(owner), { profile: 'ops', purpose: 'gateway' })
    const received: unknown[] = []
    socket.addEventListener('message', event => received.push((event as MessageEvent).data))
    await settle()

    expect(socket.url).toBe('')
    expect(harness.sockets).toHaveLength(1)
    expect(harness.sockets[0].resolvedUrl).toContain('KORGO_E2E_SENTINEL_CREDENTIAL')
    harness.sockets[0].emit('open')
    harness.sockets[0].emit('message', { data: 'first' })
    harness.sockets[0].emit('message', { data: new Blob([new Uint8Array([1, 2, 3])]) })
    harness.sockets[0].emit('message', { data: 'third' })
    await settle()

    expect(received[0]).toBe('first')
    expect(Array.from(new Uint8Array(received[1] as ArrayBuffer))).toEqual([1, 2, 3])
    expect(received[2]).toBe('third')

    socket.send(new Uint8Array([4, 5, 6]))
    expect(Array.from(harness.sockets[0].sent[0] as Uint8Array)).toEqual([4, 5, 6])
    expect(JSON.stringify(owner.events)).not.toContain('KORGO_E2E_SENTINEL_CREDENTIAL')
    expect(JSON.stringify(owner.events)).not.toMatch(/[?&](?:token|ticket)=/i)

    writeSshOnlyEvidence('gateway-proxy-ordering', {
      binaryFrameLength: 3,
      credentialMaterialReachedRenderer: false,
      orderedFrameKinds: ['text', 'binary', 'text'],
      profile: harness.profiles[0],
      rendererUrl: socket.url
    })
  })

  test('reconnects by profile and closes only the destroyed window ownership domain', async () => {
    const harness = createHarness()
    const owner = new FakeOwner()
    const otherOwner = new FakeOwner()
    const first = new NativeGatewaySocket(harness.bridgeFor(owner), { profile: 'ops', purpose: 'gateway' })
    await settle()
    harness.sockets[0].emit('open')
    harness.sockets[0].emit('close', { code: 1006, reason: 'dummy disconnect' })
    expect(first.readyState).toBe(NativeGatewaySocket.CLOSED)

    const reconnect = new NativeGatewaySocket(harness.bridgeFor(owner), { profile: 'ops', purpose: 'gateway' })
    const secondary = new NativeGatewaySocket(harness.bridgeFor(otherOwner), { profile: 'research', purpose: 'gateway' })
    await settle()
    expect(harness.profiles).toEqual(['ops', 'ops', 'research'])
    expect(harness.sockets).toHaveLength(3)

    const reconnectSocket = harness.sockets[1]
    const secondarySocket = harness.sockets[2]
    reconnectSocket.emit('open')
    secondarySocket.emit('open')
    secondary.send('secondary')
    expect(secondarySocket.sent).toEqual(['secondary'])

    // A different renderer cannot send or close the reconnect socket by id.
    const attackerBridge = harness.bridgeFor(otherOwner)
    attackerBridge.send(reconnect.id, 'cross-owner')
    attackerBridge.close(reconnect.id)
    expect(reconnectSocket.sent).toEqual([])
    expect(reconnectSocket.closeCalls).toEqual([])

    harness.disposeOwner(owner)
    expect(reconnectSocket.closeCalls).toEqual([{ code: 1001, reason: 'renderer destroyed' }])
    expect(secondarySocket.closeCalls).toEqual([])
    expect(JSON.stringify([...owner.events, ...otherOwner.events])).not.toMatch(/[?&](?:token|ticket)=/i)

    writeSshOnlyEvidence('gateway-proxy-lifecycle', {
      crossOwnerSideEffect: false,
      profileResolutionOrder: harness.profiles,
      reconnectSocketCount: 2,
      survivingOtherWindowSockets: 1,
      teardownCloseCode: reconnectSocket.closeCalls[0]?.code
    })
  })
})
