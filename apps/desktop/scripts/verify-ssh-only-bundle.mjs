#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const BANNED_ARTIFACT_MARKERS = Object.freeze([
  'install-stamp.json',
  'orgo-mcp-server',
  'tailscale.com/install.sh',
  'orgo-agent-mcp.py',
  '@composio/core',
  'composio-connectors',
  'orgo-broker',
  'orgo-desktop.json',
  'bootstrap-runner',
  'native-oauth',
  'native-token-store',
  'oauth-net-request',
  'hermes:orgo-desktop:',
  'hermes:connectors:',
  'hermes:cloud:',
  'hermes:connection-config:probe',
  'hermes:connection-config:oauth-',
  'hermes:bootstrap:',
  'hermes:updates:',
  'hermes:uninstall:',
  'hermes:fetchLinkTitle',
  'StrictHostKeyChecking=accept-new',
  '--no-sandbox',
  'remote-debugging-port',
  'remote-debugging-address',
  'HERMES_DESKTOP_CDP_PORT'
])

// These are renderer-only because generic connection persistence in main may
// still understand legacy records during migration. They must never be
// present in the compiled SSH renderer, where they would prove that a
// credential/provisioning module or its UI copy remains reachable.
export const BANNED_RENDERER_MARKERS = Object.freeze([
  'oauthLoginConnectionConfig',
  'remoteToken',
  'orgoDesktop',
  'tailscaleLocalStatus',
  'beginTailscale',
  'connectRemoteHermes',
  'Composio API key',
  'Store the gateway token in plain text?',
  'Orgo API key',
  'Paste session token',
  'Create cloud computer',
  'Use this Mac'
])

// Every forbidden content marker is also forbidden in a resource path. This
// catches an empty banned file/directory as well as marker text in a bundle.
export const BANNED_RESOURCE_NAMES = BANNED_ARTIFACT_MARKERS

const REQUIRED_IDENTITY_MARKERS = Object.freeze(['bot-ssh-only', 'Korgo Bot'])
const MAX_WALK_ENTRIES = 100_000

function walk(root, visit, depth = 0, state = { entries: 0 }) {
  if (depth > 20) throw new Error(`artifact tree is unexpectedly deep below ${root}`)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    state.entries += 1
    if (state.entries > MAX_WALK_ENTRIES) {
      throw new Error(`artifact tree exceeds ${MAX_WALK_ENTRIES} entries`)
    }
    const absolute = path.join(root, entry.name)
    visit(absolute, entry)
    if (entry.isDirectory()) walk(absolute, visit, depth + 1, state)
  }
}

function locateResourceDirectories(artifactRoot) {
  const resources = []
  const direct = path.join(artifactRoot, 'resources')
  if (fs.existsSync(direct)) resources.push(direct)

  walk(artifactRoot, (absolute, entry) => {
    if (
      entry.isDirectory() &&
      entry.name === 'resources' &&
      absolute !== direct &&
      (fs.existsSync(path.join(absolute, 'app.asar')) || fs.existsSync(path.join(absolute, 'app')))
    ) {
      resources.push(absolute)
    }
  })
  return [...new Set(resources)]
}

function scanResourceDirectory(resourcesDir) {
  const findings = []
  const identityFound = new Set()
  const appAsar = path.join(resourcesDir, 'app.asar')
  const appAsarUnpacked = path.join(resourcesDir, 'app.asar.unpacked')

  if (!fs.statSync(resourcesDir).isDirectory()) {
    return { findings: [`${resourcesDir}: resources path is not a directory`], identityFound }
  }
  if (!fs.existsSync(appAsar) || !fs.statSync(appAsar).isFile()) {
    findings.push(`${resourcesDir}: missing packaged resources/app.asar`)
  }
  if (!fs.existsSync(appAsarUnpacked) || !fs.statSync(appAsarUnpacked).isDirectory()) {
    findings.push(`${resourcesDir}: missing packaged resources/app.asar.unpacked`)
  }

  walk(resourcesDir, (absolute, entry) => {
    const relative = path.relative(resourcesDir, absolute)
    const lowerRelative = relative.toLowerCase()

    for (const marker of BANNED_RESOURCE_NAMES) {
      if (lowerRelative.includes(marker.toLowerCase())) {
        findings.push(`${relative}: banned resource name ${JSON.stringify(marker)}`)
      }
    }

    if (!entry.isFile()) return
    const contents = fs.readFileSync(absolute)
    for (const marker of BANNED_ARTIFACT_MARKERS) {
      if (contents.includes(Buffer.from(marker))) {
        findings.push(`${relative}: banned packaged marker ${JSON.stringify(marker)}`)
      }
    }
    for (const marker of REQUIRED_IDENTITY_MARKERS) {
      if (contents.includes(Buffer.from(marker))) identityFound.add(marker)
    }

    const normalizedRelative = relative.split(path.sep).join('/')
    const rendererAsset = /(?:^|\/)dist\/assets\/[^/]+\.js$/i.test(normalizedRelative)

    if (rendererAsset) {
      for (const marker of BANNED_RENDERER_MARKERS) {
        if (contents.includes(Buffer.from(marker))) {
          findings.push(`${relative}: banned SSH renderer marker ${JSON.stringify(marker)}`)
        }
      }
    }
  })

  return { findings, identityFound }
}

function extractAppImage(appImagePath) {
  const extractionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-appimage-'))
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractionDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error || result.status !== 0) {
    fs.rmSync(extractionDir, { recursive: true, force: true })
    throw new Error(
      `could not extract ${appImagePath}: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`
    )
  }
  const root = path.join(extractionDir, 'squashfs-root')
  if (!fs.existsSync(root)) {
    fs.rmSync(extractionDir, { recursive: true, force: true })
    throw new Error(`${appImagePath}: AppImage extraction did not create squashfs-root`)
  }
  return { root, cleanup: () => fs.rmSync(extractionDir, { recursive: true, force: true }) }
}

export function verifySshOnlyArtifact(inputPath) {
  const resolved = path.resolve(inputPath)
  if (!fs.existsSync(resolved)) {
    return { ok: false, findings: [`${inputPath}: artifact path does not exist`] }
  }

  let materialized = { root: resolved, cleanup: () => {} }
  try {
    if (fs.statSync(resolved).isFile()) {
      if (!resolved.toLowerCase().endsWith('.appimage')) {
        return { ok: false, findings: [`${inputPath}: expected an unpacked app directory or AppImage`] }
      }
      materialized = extractAppImage(resolved)
    } else if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, findings: [`${inputPath}: expected an unpacked app directory or AppImage`] }
    }

    const resourcesDirs = locateResourceDirectories(materialized.root)
    if (resourcesDirs.length === 0) {
      return { ok: false, findings: [`${inputPath}: no packaged resources/app.asar found`] }
    }

    const findings = []
    const identityFound = new Set()
    for (const resourcesDir of resourcesDirs) {
      const result = scanResourceDirectory(resourcesDir)
      findings.push(...result.findings)
      for (const marker of result.identityFound) identityFound.add(marker)
    }
    for (const marker of REQUIRED_IDENTITY_MARKERS) {
      if (!identityFound.has(marker)) {
        findings.push(`${inputPath}: missing required packaged identity marker ${JSON.stringify(marker)}`)
      }
    }
    return { ok: findings.length === 0, findings }
  } catch (error) {
    return { ok: false, findings: [`${inputPath}: ${error instanceof Error ? error.message : String(error)}`] }
  } finally {
    materialized.cleanup()
  }
}

function main(argv) {
  if (argv.length === 0) {
    console.error('usage: verify-ssh-only-bundle.mjs <unpacked-app-or-AppImage> [...]')
    return 2
  }

  let failed = false
  for (const artifactPath of argv) {
    const result = verifySshOnlyArtifact(artifactPath)
    if (result.ok) {
      console.log(`[verify-ssh-only-bundle] PASS ${artifactPath}`)
      continue
    }
    failed = true
    console.error(`[verify-ssh-only-bundle] FAIL ${artifactPath}`)
    for (const finding of result.findings) console.error(`  - ${finding}`)
  }
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
