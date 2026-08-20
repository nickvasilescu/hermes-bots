// Resolve electronDist at runtime (#38673, #47917): electron-builder 26.8.x can
// re-unpack a broken Electron.app; reusing the installed dist dodges that.
// npm workspace hoisting is non-deterministic — require.resolve finds electron
// wherever it landed. Dist present → -c.electronDist=<abs>/dist; absent → let
// electron-builder fetch via @electron/get (electronVersion + ELECTRON_MIRROR).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const SSH_ONLY_SKU = 'bot-ssh-only'
const LOCKED_ELECTRON_VERSION = '43.4.1'

function electronDistDir() {
  try {
    return path.join(path.dirname(require.resolve('electron/package.json')), 'dist')
  } catch {
    return null
  }
}

function distBinary(dist) {
  if (process.platform === 'darwin') {
    return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }
  if (process.platform === 'win32') {
    return path.join(dist, 'electron.exe')
  }
  return path.join(dist, 'electron')
}

function electronBuilderCli() {
  const pkgJson = require.resolve('electron-builder/package.json')
  const bin = require(pkgJson).bin
  const rel = typeof bin === 'string' ? bin : bin['electron-builder']
  return path.join(path.dirname(pkgJson), rel)
}

const dist = electronDistDir()
const args = []
const isSshOnlyBuild = process.env.HERMES_DESKTOP_SKU === SSH_ONLY_SKU
let temporaryConfigDir = null

if (!isSshOnlyBuild && dist && fs.existsSync(distBinary(dist))) {
  args.push(`-c.electronDist=${dist}`)
} else if (!isSshOnlyBuild) {
  console.warn(
    '[run-electron-builder] no local electron dist; electron-builder will fetch ' +
      'via @electron/get (electronVersion + ELECTRON_MIRROR).'
  )
}

if (isSshOnlyBuild) {
  let installedVersion = null
  try {
    installedVersion = require('electron/package.json').version
  } catch {
    // Report the locked-distribution failure below without allowing a fetch.
  }

  if (installedVersion !== LOCKED_ELECTRON_VERSION || !dist || !fs.existsSync(distBinary(dist))) {
    console.error(
      `[run-electron-builder] ${SSH_ONLY_SKU} requires the installed Electron ` +
        `${LOCKED_ELECTRON_VERSION} distribution; refusing electron-builder download fallback.`
    )
    process.exit(1)
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package.json'), 'utf8'))
  const baseConfig = packageJson.build || {}
  const sshOnlyConfig = {
    ...baseConfig,
    electronVersion: LOCKED_ELECTRON_VERSION,
    electronDist: dist,
    appId: 'com.nousresearch.hermes-bots',
    productName: 'Korgo Bot',
    executableName: 'Korgo Bot',
    artifactName: 'Korgo-Bot-${version}-${os}-${arch}.${ext}',
    icon: 'assets/korgo-bot-icon',
    extraMetadata: {
      ...(baseConfig.extraMetadata || {}),
      productName: 'Korgo Bot',
      hermesDesktopSku: SSH_ONLY_SKU
    },
    // The client SKU must not inherit install-stamp, Orgo, or any other
    // full-product resources from package.json.
    extraResources: [],
    linux: {
      ...(baseConfig.linux || {}),
      target: ['AppImage']
    }
  }

  temporaryConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-ssh-only-builder-'))
  const configPath = path.join(temporaryConfigDir, 'electron-builder.json')
  fs.writeFileSync(configPath, JSON.stringify(sshOnlyConfig), 'utf8')
  args.push(`--config=${configPath}`)
} else if (process.env.HERMES_DESKTOP_PRODUCT === 'bot') {
  args.push(
    '-c.appId=com.nousresearch.hermes-bots',
    '-c.productName=Korgo Bot',
    '-c.executableName=Korgo Bot',
    '-c.artifactName=Korgo-Bot-${version}-${os}-${arch}.${ext}',
    '-c.icon=assets/korgo-bot-icon',
    '-c.dmg.title=Install Korgo Bot',
    '-c.mac.extendInfo.CFBundleDisplayName=Korgo Bot',
    '-c.mac.extendInfo.CFBundleExecutable=Korgo Bot',
    '-c.mac.extendInfo.CFBundleName=Korgo Bot'
  )
}

args.push(...process.argv.slice(2))

const result = spawnSync(process.execPath, [electronBuilderCli(), ...args], {
  stdio: 'inherit'
})
if (temporaryConfigDir) {
  fs.rmSync(temporaryConfigDir, { recursive: true, force: true })
}
if (result.error) {
  console.error(`[run-electron-builder] spawn failed: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status == null ? 1 : result.status)
