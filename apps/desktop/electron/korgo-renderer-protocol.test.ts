import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  createKorgoRendererHandler,
  KORGO_RENDERER_ENTRY_URL,
  KORGO_RENDERER_SCHEME,
  registerKorgoRendererScheme
} from './korgo-renderer-protocol'

test('registers a secure standard application scheme', () => {
  let registrations: unknown
  registerKorgoRendererScheme({
    handle: () => undefined,
    registerSchemesAsPrivileged: value => {
      registrations = value
    }
  })
  assert.deepEqual(registrations, [
    {
      scheme: KORGO_RENDERER_SCHEME,
      privileges: { corsEnabled: true, secure: true, standard: true, supportFetchAPI: true }
    }
  ])
})

test('serves only files below the renderer root', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-renderer-'))
  const outside = `${root}-outside.txt`
  t.onTestFinished(() => {
    fs.rmSync(root, { force: true, recursive: true })
    fs.rmSync(outside, { force: true })
  })
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Korgo</title>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export {}')
  fs.writeFileSync(outside, 'secret')

  const handler = createKorgoRendererHandler(root)
  const index = await handler(new Request(KORGO_RENDERER_ENTRY_URL))
  assert.equal(index.status, 200)
  assert.equal(await index.text(), '<title>Korgo</title>')
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8')

  const asset = await handler(new Request(`${KORGO_RENDERER_SCHEME}://bundle/assets/app.js`))
  assert.equal(asset.status, 200)
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8')

  for (const url of [
    'file:///etc/passwd',
    `${KORGO_RENDERER_SCHEME}://evil/index.html`,
    `${KORGO_RENDERER_SCHEME}://bundle/%2e%2e/${path.basename(outside)}`,
    `${KORGO_RENDERER_SCHEME}://bundle/missing.js`
  ]) {
    assert.equal((await handler(new Request(url))).status, 404, url)
  }
})

test('rejects mutating methods before reading the bundle', async () => {
  const handler = createKorgoRendererHandler('/does/not/matter')
  const response = await handler(new Request(KORGO_RENDERER_ENTRY_URL, { method: 'POST' }))
  assert.equal(response.status, 405)
})

test('rejects renderer symlinks even when their target remains in the bundle', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-renderer-symlink-'))
  t.onTestFinished(() => fs.rmSync(root, { force: true, recursive: true }))
  fs.writeFileSync(path.join(root, 'app.js'), 'export {}')

  try {
    fs.symlinkSync(path.join(root, 'app.js'), path.join(root, 'alias.js'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip()

      return
    }

    throw error
  }

  const handler = createKorgoRendererHandler(root)
  assert.equal((await handler(new Request(`${KORGO_RENDERER_SCHEME}://bundle/alias.js`))).status, 404)
})

test('rejects renderer paths with an intermediate symlink', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-renderer-symlink-dir-'))
  t.onTestFinished(() => fs.rmSync(root, { force: true, recursive: true }))
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export {}')

  try {
    fs.symlinkSync(path.join(root, 'assets'), path.join(root, 'linked-assets'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip()

      return
    }

    throw error
  }

  const handler = createKorgoRendererHandler(root)
  assert.equal((await handler(new Request(`${KORGO_RENDERER_SCHEME}://bundle/linked-assets/app.js`))).status, 404)
})
