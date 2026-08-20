import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createAuthorizedIpc } from './ipc-policy'
import { ERR_UNTRUSTED_IPC_SENDER, IpcTrustRegistry } from './ipc-trust'

function harness() {
  const registrations = new Map<string, (...args: any[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (...args: any[]) => unknown) => registrations.set(channel, listener),
    on: (channel: string, listener: (...args: any[]) => unknown) => registrations.set(channel, listener)
  }
  const registry = new IpcTrustRegistry()
  const frame: { top?: unknown; url: string } = { url: 'file:///opt/korgo/index.html' }
  frame.top = frame
  const sender = { id: 7, isDestroyed: () => false, mainFrame: frame }

  return { ipcMain, registrations, registry, sender, trustedEvent: { sender, senderFrame: frame } }
}

test('allows only the classified window capability', async () => {
  const h = harness()
  h.registry.register(h.sender, 'primary')
  let sideEffects = 0
  const authorized = createAuthorizedIpc({
    ipcMain: h.ipcMain,
    isTrustedRendererUrl: url => url === 'file:///opt/korgo/index.html',
    policy: { 'hermes:test': ['primary'] },
    registry: h.registry
  })
  authorized.handle('hermes:test', () => {
    sideEffects += 1

    return 'ok'
  })

  assert.equal(await h.registrations.get('hermes:test')?.(h.trustedEvent), 'ok')
  assert.equal(sideEffects, 1)
})

test('denies before side effects and never logs payloads', () => {
  const h = harness()
  h.registry.register(h.sender, 'session')
  const denied: unknown[] = []
  let sideEffects = 0
  const authorized = createAuthorizedIpc({
    ipcMain: h.ipcMain,
    isTrustedRendererUrl: () => true,
    onDenied: metadata => denied.push(metadata),
    policy: { 'hermes:test': ['primary'] },
    registry: h.registry
  })
  authorized.handle('hermes:test', () => {
    sideEffects += 1
  })

  assert.throws(() => h.registrations.get('hermes:test')?.(h.trustedEvent, { token: 'sentinel' }), error => {
    assert.equal((error as { code?: string }).code, ERR_UNTRUSTED_IPC_SENDER)

    return true
  })
  assert.equal(sideEffects, 0)
  assert.deepEqual(denied, [{ channel: 'hermes:test', senderId: 7 }])
  assert.equal(JSON.stringify(denied).includes('sentinel'), false)
})

test('refuses unclassified channels at registration time', () => {
  const h = harness()
  const authorized = createAuthorizedIpc({
    ipcMain: h.ipcMain,
    isTrustedRendererUrl: () => true,
    policy: {},
    registry: h.registry
  })

  assert.throws(() => authorized.handle('hermes:unknown', () => undefined), /Unclassified IPC channel/)
})
