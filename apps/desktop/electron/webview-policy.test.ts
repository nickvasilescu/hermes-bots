import assert from 'node:assert/strict'

import { test } from 'vitest'

import { decideWebviewAttachment } from './webview-policy'

const policy = {
  allowedFileRoots: ['/tmp/korgo-preview'],
  isTrustedParentUrl: (url: string) => url === 'file:///opt/korgo/index.html'
}

test('denies untrusted and non-top-level parents', () => {
  const base = {
    parentIsTopLevel: true,
    parentUrl: 'file:///opt/korgo/index.html',
    src: 'https://example.com/',
    webPreferences: {}
  }

  assert.deepEqual(decideWebviewAttachment({ ...base, parentIsTopLevel: false }, policy), {
    allow: false,
    reason: 'untrusted-parent'
  })
  assert.deepEqual(decideWebviewAttachment({ ...base, parentUrl: 'https://evil.test/' }, policy), {
    allow: false,
    reason: 'untrusted-parent'
  })
})

test('denies active and unapproved local sources', () => {
  const base = {
    parentIsTopLevel: true,
    parentUrl: 'file:///opt/korgo/index.html',
    webPreferences: {}
  }

  for (const src of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'blob:https://example.com/id']) {
    assert.equal(decideWebviewAttachment({ ...base, src }, policy).allow, false, src)
  }
})

test('overwrites dangerous preferences for approved sources', () => {
  const result = decideWebviewAttachment(
    {
      parentIsTopLevel: true,
      parentUrl: 'file:///opt/korgo/index.html',
      src: 'file:///tmp/korgo-preview/index.html',
      webPreferences: {
        allowRunningInsecureContent: true,
        nodeIntegration: true,
        partition: 'persist:evil',
        preload: '/tmp/evil.cjs',
        sandbox: false,
        webSecurity: false
      }
    },
    policy
  )

  assert.equal(result.allow, true)

  if (result.allow) {
    assert.equal(result.webPreferences.nodeIntegration, false)
    assert.equal(result.webPreferences.partition, undefined)
    assert.equal(result.webPreferences.preload, undefined)
    assert.equal(result.webPreferences.sandbox, true)
    assert.equal(result.webPreferences.webSecurity, true)
  }
})
