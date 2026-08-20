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
  'hermes:readFileDataUrl',
  'hermes:readFileDataUrlForAttach',
  'hermes:readFileText',
  'hermes:data-url-read-max',
  'hermes:selectPaths',
  'hermes:selectSavePath',
  'hermes:fs:',
  'hermes:git:',
  'hermes:terminal:',
  'hermes:window:readBelow',
  'hermes:pet-overlay:',
  'hermes:ssh-config:',
  'hermes:openExternal',
  'hermes:openPreviewInBrowser',
  'hermes:vscode-theme:',
  'Save Image As...',
  'Copy Image Address',
  'node-pty',
  'get-windows',
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
  'Use this Mac',
  'Add a provider credential before sending your first message.',
  'No API key configured for provider',
  'invalid_api_key',
  'voice_tools_openai_key',
  'startOAuthLogin',
  'pollOAuthSession',
  'submitOAuthCode',
  'validateProviderCredential',
  'saveOnboardingApiKey',
  'Tool Gateway enabled',
  'FIREWORKS_API_KEY',
  'authMcpServer',
  'getMcpOAuthFlow',
  'installMcpCatalogEntry',
  'mcp.setup.respond',
  'mcp.setup.request',
  'reload.mcp',
  'mcp-setup-inline',
  'Install the cua-driver backend below',
  'Grant permissions',
  'Could not start sign-in',
  'browser.manage',
  'Manage browser CDP connection',
  'BROWSER_CDP_URL',
  'checkHermesUpdate',
  'openUpdatesWindow',
  '/api/hermes/update',
  '/api/gateway/restart',
  'Uninstall Hermes',
  '/api/memory/reset',
  '/api/curator/paused',
  '/api/curator/run',
  '/api/ops/doctor',
  '/api/ops/security-audit',
  '/api/ops/backup',
  '/api/ops/debug-share',
  '/api/logs',
  '/api/analytics/usage',
  '/api/messaging/platforms',
  'TELEGRAM_BOT_TOKEN',
  'clear_env',
  '/api/webhooks',
  '/api/skills',
  '/api/skills/toggle',
  '/api/skills/hub/install',
  '/api/skills/hub/uninstall',
  '/api/skills/hub/update',
  'createProfile',
  'renameProfile',
  'deleteProfile',
  'updateProfileSoul',
  '/api/profiles/import',
  '/soul',
  '/api/cron/jobs',
  'pauseCronJob',
  'resumeCronJob',
  'triggerCronJob',
  'deleteCronJob',
  'handoff.request',
  'handoff.state',
  'handoff.fail',
  'Always allow this command?',
  'Allow this session',
  'Refresh Models',
  'providers&pview=keys',
  'keys&kview=settings',
  'tab=mcp',
  '/api/learning/graph',
  '/api/learning/node',
  '/api/plugins/',
  'profiles.list',
  'profiles.get_asset',
  'profiles.configure',
  'profiles.create',
  'profiles.set_asset',
  'cron.manage',
  'cli.exec',
  'image.generate',
  'The default profile cannot be deleted.',
  'profile.export',
  'profile.import',
  'Export profile…',
  'Import profile…',
  'session.yolo',
  '/yolo',
  'YOLO armed for this chat',
  'Toggle YOLO',
  'body:{config:',
  'sudo.request',
  'sudo.respond',
  'secret.request',
  'secret.respond',
  'projects.list',
  'projects.tree',
  'projects.project_sessions',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.add_folder',
  'projects.set_active',
  'projects.record_repos',
  'session.workspace.move',
  'pet.select',
  'pet.scale',
  'pet.rename',
  'pet.remove',
  'pet.gallery',
  'pet.disable',
  'searchMarketplace',
  'fetchMarketplace',
  'slash.exec',
  'command.dispatch',
  'hermes-bots:pane-v2',
  'readFileDataUrl',
  'readFileDataUrlForAttach',
  'readFileText',
  'hermesDesktop.openExternal',
  'display.message_reactions',
  'Always allow ',
  'Install theme',
  'open.spotify.com/embed',
  'www.youtube.com/embed',
  '/api/fs/',
  '/api/git/',
  '/api/files/download',
  'workspace.openFolder',
  'view.showTerminal',
  'keybinds.openPanel',
  'Attach git context',
  'composer.cronSuggestions',
  'layout.editMode',
  'plugins.reload',
  'layout.reset',
  'view.toggleStatusbar',
  'keybinds.panel',
  'view.toggleSidebar',
  'view.flipPanes',
  'view.toggleRightSidebar',
  'view.toggleHud',
  'aui_artifact-card',
  'quick-entry-target',
  'wake-indicator-surface'
])

export const BANNED_RENDERER_HTML_MARKERS = Object.freeze(['http://127.0.0.1:*', 'ws://127.0.0.1:*'])

// Every forbidden content marker is also forbidden in a resource path. This
// catches an empty banned file/directory as well as marker text in a bundle.
export const BANNED_RESOURCE_NAMES = BANNED_ARTIFACT_MARKERS

export const REQUIRED_IDENTITY_MARKERS = Object.freeze([
  'bot-ssh-only',
  'Korgo Bot',
  'Connect existing Hermes over SSH',
  'Mini Tailscale IP',
  'New session'
])
const MAX_WALK_ENTRIES = 100_000

function validateRendererCsp(contents, relative) {
  const html = contents.toString('utf8')
  const policies = (html.match(/<meta\b[^>]*>/giu) ?? []).filter(tag =>
    /\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/iu.test(tag)
  )

  if (policies.length !== 1) {
    return [`${relative}: expected exactly one Content-Security-Policy meta tag, found ${policies.length}`]
  }

  const content = policies[0].match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/iu)?.[2]

  if (!content) {
    return [`${relative}: Content-Security-Policy meta tag is missing its content attribute`]
  }

  const connectDirectives = content
    .split(';')
    .map(directive => directive.trim().split(/\s+/u))
    .filter(tokens => tokens[0]?.toLowerCase() === 'connect-src')

  if (connectDirectives.length !== 1 || connectDirectives[0].length !== 2 || connectDirectives[0][1] !== "'self'") {
    return [`${relative}: SSH renderer CSP must contain exactly connect-src 'self'`]
  }

  return []
}

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
  let rendererHtmlCount = 0
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
    const rendererHtml = /(?:^|\/)dist\/index\.html$/i.test(normalizedRelative)

    if (rendererAsset) {
      for (const marker of BANNED_RENDERER_MARKERS) {
        if (contents.includes(Buffer.from(marker))) {
          findings.push(`${relative}: banned SSH renderer marker ${JSON.stringify(marker)}`)
        }
      }
    }

    if (rendererHtml) {
      rendererHtmlCount += 1
      for (const marker of BANNED_RENDERER_HTML_MARKERS) {
        if (contents.includes(Buffer.from(marker))) {
          findings.push(`${relative}: banned SSH renderer CSP marker ${JSON.stringify(marker)}`)
        }
      }
      findings.push(...validateRendererCsp(contents, relative))
    }
  })

  if (rendererHtmlCount !== 1) {
    findings.push(`${resourcesDir}: expected exactly one packaged dist/index.html, found ${rendererHtmlCount}`)
  }

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
