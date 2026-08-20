import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { test } from 'vitest'

import { isTrustedRendererUrl, isTrustedTopLevelFrame } from './renderer-origin'

const entry = path.resolve('/opt/korgo/resources/app/dist/index.html')
const packaged = { isPackaged: true, rendererEntryPath: entry }

test('accepts only the exact packaged renderer entry', () => {
  const url = pathToFileURL(entry)
  url.search = '?win=secondary'
  url.hash = '#/session'

  assert.equal(isTrustedRendererUrl(url.toString(), packaged), true)
  assert.equal(isTrustedRendererUrl(pathToFileURL(`${entry}.bak`).toString(), packaged), false)
  assert.equal(isTrustedRendererUrl(pathToFileURL(path.resolve(entry, '../other.html')).toString(), packaged), false)
})

test('does not allow an http origin in a packaged app', () => {
  assert.equal(isTrustedRendererUrl('https://example.com/index.html', packaged), false)
})

test('accepts the exact development origin only outside packaged mode', () => {
  const dev = { devServerUrl: 'http://127.0.0.1:5174/', isPackaged: false, rendererEntryPath: entry }

  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/#/chat', dev), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5174/#/chat', dev), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174.evil.test/', dev), false)
  assert.equal(isTrustedRendererUrl('http://user@127.0.0.1:5174/', dev), false)
})

test('requires the trusted renderer to be the top-level frame', () => {
  const url = pathToFileURL(entry).toString()
  const top: { top?: unknown; url: string } = { url }
  top.top = top
  const child = { top, url }

  assert.equal(isTrustedTopLevelFrame(top, packaged), true)
  assert.equal(isTrustedTopLevelFrame(child, packaged), false)
  assert.equal(isTrustedTopLevelFrame(null, packaged), false)
})
