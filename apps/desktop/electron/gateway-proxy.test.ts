import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import { GATEWAY_PROXY_CHANNELS, registerGatewayProxy } from './gateway-proxy'

function harness(options: { sshOnly?: boolean } = {}) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const listeners = new Map<string, (...args: any[]) => unknown>()
  const socketListeners = new Map<string, (event: any) => void>()

  const socket = {
    addEventListener: vi.fn((type: string, listener: (event: any) => void) => socketListeners.set(type, listener)),
    binaryType: '',
    bufferedAmount: 0,
    close: vi.fn(),
    send: vi.fn()
  }

  const owner = { id: 1, isDestroyed: () => false, send: vi.fn() }
  const other = { id: 2, isDestroyed: () => false, send: vi.fn() }
  const resolveUrl = vi.fn().mockResolvedValue('ws://127.0.0.1:9119/api/ws?token=secret-sentinel')
  const urls: string[] = []

  const proxy = registerGatewayProxy({
    createSocket: url => {
      urls.push(url)

      return socket
    },
    ipc: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener)
    },
    resolveUrl,
    sshOnly: options.sshOnly
  })

  return { handlers, listeners, other, owner, proxy, resolveUrl, socket, socketListeners, urls }
}

test('owns the credential URL in main and emits only socket events', async () => {
  const h = harness()
  const request = { id: 'socket-1234', profile: 'work', purpose: 'gateway' }
  await h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: h.owner }, request)
  h.socketListeners.get('open')?.({})

  assert.equal(h.urls[0], 'ws://127.0.0.1:9119/api/ws?token=secret-sentinel')
  assert.deepEqual(h.owner.send.mock.calls[0], [GATEWAY_PROXY_CHANNELS.event, { id: request.id, type: 'open' }])
  assert.equal(JSON.stringify(h.owner.send.mock.calls).includes('secret-sentinel'), false)
})

test('rewrites only approved plugin and voice endpoints', async () => {
  const plugin = harness()
  await plugin.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
    { sender: plugin.owner },
    { id: 'plugin-1234', path: '/api/plugins/kanban/events?board=one', purpose: 'plugin' }
  )
  assert.match(plugin.urls[0], /\/api\/plugins\/kanban\/events/)
  assert.match(plugin.urls[0], /board=one/)

  const voice = harness()
  await voice.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
    { sender: voice.owner },
    { id: 'voice-12345', path: '/api/audio/speak-stream', profile: 'work', purpose: 'voice' }
  )
  assert.match(voice.urls[0], /\/api\/audio\/speak-stream/)
  assert.match(voice.urls[0], /profile=work/)

  await assert.rejects(
    plugin.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
      { sender: plugin.owner },
      { id: 'plugin-evil1', path: '/api/plugins/x/../admin', purpose: 'plugin' }
    ) as Promise<unknown>,
    /Invalid plugin/
  )
  await assert.rejects(
    plugin.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
      { sender: plugin.owner },
      { id: 'plugin-evil2', path: '/api/plugins/x/events?token=override', purpose: 'plugin' }
    ) as Promise<unknown>,
    /Invalid plugin/
  )
})

test('prevents cross-renderer send and close', async () => {
  const h = harness()
  const id = 'socket-5678'
  await h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: h.owner }, { id, profile: null, purpose: 'gateway' })
  h.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.({ sender: h.other }, { data: 'stolen', id })
  h.listeners.get(GATEWAY_PROXY_CHANNELS.close)?.({ sender: h.other }, { id })
  assert.equal(h.socket.send.mock.calls.length, 0)
  assert.equal(h.socket.close.mock.calls.length, 0)

  h.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.({ sender: h.owner }, { data: 'ok', id })
  assert.deepEqual(h.socket.send.mock.calls[0], ['ok'])
})

test('scopes ids per renderer, redacts close reasons, and tears down ownership', async () => {
  const h = harness()
  const id = 'shared-12345'
  await h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: h.owner }, { id, purpose: 'gateway' })
  await h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: h.other }, { id, purpose: 'gateway' })

  h.socketListeners.get('close')?.({ code: 1011, reason: 'failed ?token=secret-sentinel&retry=1' })
  const payloads = h.other.send.mock.calls.map(call => call[1])
  assert.equal(JSON.stringify(payloads).includes('secret-sentinel'), false)
  assert.equal(payloads.at(-1)?.reason, 'failed ?token=[redacted]&retry=1')

  h.proxy.disposeOwner(h.owner as any)
  assert.equal(
    h.socket.close.mock.calls.some(call => call[0] === 1001),
    true
  )
})

test('SSH-only rejects plugin startup before URL resolution or socket creation', async () => {
  const h = harness({ sshOnly: true })

  await assert.rejects(
    h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
      { sender: h.owner },
      { id: 'plugin-ssh1', path: '/api/plugins/kanban/events', purpose: 'plugin' }
    ) as Promise<unknown>,
    /unavailable in SSH-only/
  )
  assert.equal(h.resolveUrl.mock.calls.length, 0)
  assert.equal(h.urls.length, 0)
})

test('SSH-only rejects forbidden gateway frames before socket side effects', async () => {
  const h = harness({ sshOnly: true })
  const id = 'socket-ssh1'

  await h.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.({ sender: h.owner }, { id, purpose: 'gateway' })
  h.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.(
    { sender: h.owner },
    {
      data: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'browser.manage', params: { action: 'connect' } }),
      id
    }
  )

  assert.equal(h.socket.send.mock.calls.length, 0)
  assert.deepEqual(h.socket.close.mock.calls.at(-1), [1008, 'gateway operation denied'])
})

test('SSH-only forwards an authorized chat frame and bounded voice frames', async () => {
  const gateway = harness({ sshOnly: true })
  const gatewayId = 'socket-ssh2'

  const chat = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'prompt.submit',
    params: { session_id: 's1', text: 'hi' }
  })

  await gateway.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
    { sender: gateway.owner },
    { id: gatewayId, purpose: 'gateway' }
  )
  gateway.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.({ sender: gateway.owner }, { data: chat, id: gatewayId })
  assert.deepEqual(gateway.socket.send.mock.calls.at(-1), [chat])

  const voice = harness({ sshOnly: true })
  const voiceId = 'voice-ssh1'

  await voice.handlers.get(GATEWAY_PROXY_CHANNELS.start)?.(
    { sender: voice.owner },
    { id: voiceId, path: '/api/audio/speak-stream', purpose: 'voice' }
  )
  voice.listeners.get(GATEWAY_PROXY_CHANNELS.send)?.(
    { sender: voice.owner },
    { data: JSON.stringify({ text: 'hello' }), id: voiceId }
  )
  assert.deepEqual(voice.socket.send.mock.calls.at(-1), [JSON.stringify({ text: 'hello' })])
})
