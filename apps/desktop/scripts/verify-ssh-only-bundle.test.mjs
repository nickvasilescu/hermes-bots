import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

import {
  BANNED_ARTIFACT_MARKERS,
  BANNED_RENDERER_HTML_MARKERS,
  BANNED_RENDERER_MARKERS,
  BANNED_RESOURCE_NAMES,
  REQUIRED_IDENTITY_MARKERS
} from './verify-ssh-only-bundle.mjs'

const verifier = fileURLToPath(new URL('./verify-ssh-only-bundle.mjs', import.meta.url))

function fixture(contents = 'Korgo Bot bot-ssh-only clean packaged application') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-ssh-only-fixture-'))
  const resources = path.join(root, 'resources')
  fs.mkdirSync(path.join(resources, 'app.asar.unpacked', 'dist', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'app.asar'), contents)
  fs.writeFileSync(
    path.join(resources, 'app.asar.unpacked', 'dist', 'assets', 'renderer.js'),
    'Connect existing Hermes over SSH Mini Tailscale IP New session'
  )
  fs.writeFileSync(
    path.join(resources, 'app.asar.unpacked', 'dist', 'index.html'),
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'self\'">'
  )
  return root
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' })
}

test('executed verifier rejects every banned packaged content marker', () => {
  for (const marker of BANNED_ARTIFACT_MARKERS) {
    const root = fixture(`Korgo Bot bot-ssh-only\n${marker}`)
    try {
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, marker)
      assert.match(result.stderr, /banned packaged marker/, marker)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier rejects banned resource names', () => {
  for (const marker of BANNED_RESOURCE_NAMES) {
    const root = fixture()
    try {
      const bannedPath = path.join(root, 'resources', 'app.asar.unpacked', marker)
      fs.mkdirSync(path.dirname(bannedPath), { recursive: true })
      fs.writeFileSync(bannedPath, 'otherwise clean')
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, marker)
      assert.match(result.stderr, /banned resource name/, marker)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier rejects empty staged host-native package directories', () => {
  for (const packageName of ['node-pty', 'get-windows']) {
    const root = fixture()
    try {
      fs.mkdirSync(path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'node_modules', packageName), {
        recursive: true
      })
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, packageName)
      assert.match(result.stderr, /banned resource name/, packageName)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier rejects every banned SSH renderer marker', { timeout: 30_000 }, () => {
  for (const marker of BANNED_RENDERER_MARKERS) {
    const root = fixture()
    try {
      fs.writeFileSync(path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'assets', 'renderer.js'), marker)
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, marker)
      assert.match(result.stderr, /banned SSH renderer marker/, marker)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('renderer-only markers do not reject a main-process migration identifier', () => {
  const root = fixture()
  try {
    fs.writeFileSync(path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'electron-main.mjs'), 'remoteToken')
    const result = runVerifier(root)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('executed verifier rejects loopback access in the SSH renderer CSP', () => {
  for (const marker of BANNED_RENDERER_HTML_MARKERS) {
    const root = fixture()
    try {
      fs.writeFileSync(path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'index.html'), marker)
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, marker)
      assert.match(result.stderr, /banned SSH renderer CSP marker/, marker)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier requires one exact self-only SSH renderer CSP', () => {
  const variants = [
    '<html><head></head></html>',
    '<meta http-equiv="Content-Security-Policy" content="connect-src *">',
    '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\' https:">',
    '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'">'.repeat(2)
  ]

  for (const html of variants) {
    const root = fixture()
    try {
      fs.writeFileSync(path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'index.html'), html)
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, html)
      assert.match(result.stderr, /Content-Security-Policy|connect-src/, html)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier fails closed when packaged resources are incomplete', () => {
  const root = fixture()
  try {
    fs.rmSync(path.join(root, 'resources', 'app.asar.unpacked'), { recursive: true, force: true })
    const result = runVerifier(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing packaged resources\/app\.asar\.unpacked/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('executed verifier rejects a package missing any required SSH UI identity marker', () => {
  for (const marker of REQUIRED_IDENTITY_MARKERS) {
    const root = fixture()
    try {
      for (const file of [
        path.join(root, 'resources', 'app.asar'),
        path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'assets', 'renderer.js')
      ]) {
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(marker, 'removed-marker'))
      }
      const result = runVerifier(root)
      assert.notEqual(result.status, 0, marker)
      assert.match(result.stderr, /missing required packaged identity marker/, marker)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('executed verifier passes a clean complete packaged fixture', () => {
  const root = fixture()
  try {
    const result = runVerifier(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PASS/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
