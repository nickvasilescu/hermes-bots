import assert from 'node:assert/strict'

import { test } from 'vitest'

import { IpcTrustRegistry, type WindowCapability } from './ipc-trust'

function fixture(url = 'file:///opt/korgo/index.html') {
  const frame: { top?: unknown; url: string } = { url }
  frame.top = frame
  const sender = { id: 42, isDestroyed: () => false, mainFrame: frame }

  return { event: { sender, senderFrame: frame }, frame, sender }
}

test('identifies a registered trusted top-level renderer', () => {
  const registry = new IpcTrustRegistry()
  const { event, sender } = fixture()
  registry.register(sender, 'primary')

  assert.deepEqual(
    registry.identify(event, url => url === 'file:///opt/korgo/index.html'),
    {
      capability: 'primary',
      senderId: 42
    }
  )
})

test('keeps all window classes distinct', () => {
  const capabilities: WindowCapability[] = ['primary', 'session', 'hud', 'quick-entry', 'pet-overlay']

  for (const capability of capabilities) {
    const registry = new IpcTrustRegistry()
    const { event, sender } = fixture()
    registry.register(sender, capability)

    assert.equal(registry.identify(event, () => true)?.capability, capability)
  }
})

test('rejects missing sender and senderFrame metadata', () => {
  const registry = new IpcTrustRegistry()
  const { sender } = fixture()
  registry.register(sender, 'primary')

  assert.equal(
    registry.identify({}, () => true),
    null
  )
  assert.equal(
    registry.identify({ sender, senderFrame: null }, () => true),
    null
  )
})

test('rejects unregistered and forged webContents identities', () => {
  const registry = new IpcTrustRegistry()
  const { event, frame, sender } = fixture()
  const isTrusted = (url: string) => url === 'file:///opt/korgo/index.html'

  assert.equal(registry.identify(event, isTrusted), null)
  registry.register(sender, 'primary')
  assert.equal(registry.identify({ ...event, sender: { ...sender } }, isTrusted), null)

  const webviewFrame: { top?: unknown; url: string } = { url: frame.url }
  webviewFrame.top = webviewFrame
  const webview = { id: 99, isDestroyed: () => false, mainFrame: webviewFrame }
  assert.equal(registry.identify({ sender: webview, senderFrame: webviewFrame }, isTrusted), null)
})

test('rejects destroyed, subframe, foreign-frame, and navigated senders', () => {
  const registry = new IpcTrustRegistry()
  const { event, frame, sender } = fixture()
  const isTrusted = (url: string) => url === 'file:///opt/korgo/index.html'
  registry.register(sender, 'primary')

  sender.isDestroyed = () => true
  assert.equal(registry.identify(event, isTrusted), null)
  sender.isDestroyed = () => false

  const subframe = { top: frame, url: frame.url }
  assert.equal(registry.identify({ ...event, senderFrame: subframe }, isTrusted), null)

  const foreignFrame: { top?: unknown; url: string } = { url: frame.url }
  foreignFrame.top = foreignFrame
  assert.equal(registry.identify({ ...event, senderFrame: foreignFrame }, isTrusted), null)

  frame.url = 'https://evil.test/'
  assert.equal(registry.identify(event, isTrusted), null)
})

test('a stale disposer cannot unregister a replacement capability', () => {
  const registry = new IpcTrustRegistry()
  const { event, sender } = fixture()
  const disposePrimary = registry.register(sender, 'primary')
  registry.register(sender, 'session')
  disposePrimary()

  assert.equal(registry.identify(event, () => true)?.capability, 'session')
})
