import assert from 'node:assert/strict'

import { test } from 'vitest'

import { mayGrantMediaPermission } from './media-permission-policy'

const policy = { isTrustedRendererUrl: (url: string) => url === 'file:///opt/korgo/index.html' }
const trusted = {
  isRegisteredApplicationContents: true,
  isTopLevelFrame: true,
  mediaTypes: ['audio'],
  permission: 'media',
  requestingUrl: 'file:///opt/korgo/index.html'
}

test('allows audio/video only for a registered top-level application renderer', () => {
  assert.equal(mayGrantMediaPermission(trusted, policy), true)
  assert.equal(mayGrantMediaPermission({ ...trusted, mediaTypes: ['audio', 'video'] }, policy), true)
})

test('denies guests, subframes, unknown origins, and non-media permissions', () => {
  assert.equal(mayGrantMediaPermission({ ...trusted, isRegisteredApplicationContents: false }, policy), false)
  assert.equal(mayGrantMediaPermission({ ...trusted, isTopLevelFrame: false }, policy), false)
  assert.equal(mayGrantMediaPermission({ ...trusted, requestingUrl: 'https://evil.test/' }, policy), false)
  assert.equal(mayGrantMediaPermission({ ...trusted, permission: 'notifications' }, policy), false)
})

test('denies empty or unexpected media types', () => {
  assert.equal(mayGrantMediaPermission({ ...trusted, mediaTypes: [] }, policy), false)
  assert.equal(mayGrantMediaPermission({ ...trusted, mediaTypes: ['display-capture'] }, policy), false)
})
