import assert from 'node:assert/strict'

import { test } from 'vitest'

import { IpcTrustRegistry } from './ipc-trust'

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

  assert.deepEqual(registry.identify(event, url => url === 'file:///opt/korgo/index.html'), {
    capability: 'primary',
    senderId: 42
  })
})

test('rejects unregistered, destroyed, navigated, and subframe senders', () => {
  const registry = new IpcTrustRegistry()
  const { event, frame, sender } = fixture()
  const isTrusted = (url: string) => url === 'file:///opt/korgo/index.html'

  assert.equal(registry.identify(event, isTrusted), null)
  registry.register(sender, 'primary')
  assert.equal(registry.identify({ ...event, sender: { ...sender, isDestroyed: () => true } }, isTrusted), null)
  assert.equal(registry.identify({ ...event, senderFrame: { top: frame, url: frame.url } }, isTrusted), null)
  assert.equal(registry.identify({ ...event, senderFrame: { top: frame, url: 'https://evil.test/' } }, isTrusted), null)
})
