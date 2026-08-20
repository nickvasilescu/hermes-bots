import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { BANNED_ARTIFACT_MARKERS, BANNED_RENDERER_MARKERS, BANNED_RESOURCE_NAMES } from './verify-ssh-only-bundle.mjs'

const verifier = fileURLToPath(new URL('./verify-ssh-only-bundle.mjs', import.meta.url))

function fixture(contents = 'Korgo Bot bot-ssh-only clean packaged application') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-ssh-only-fixture-'))
  const resources = path.join(root, 'resources')
  fs.mkdirSync(path.join(resources, 'app.asar.unpacked', 'dist', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'app.asar'), contents)
  fs.writeFileSync(path.join(resources, 'app.asar.unpacked', 'dist', 'assets', 'renderer.js'), 'clean')
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

test('executed verifier rejects every banned SSH renderer marker', () => {
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
