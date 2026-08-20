#!/usr/bin/env node
// bundle-electron-main.mjs — bundles electron/main.ts and electron/preload.ts
// into self-contained js files in dist/ so the packaged app doesn't need
// node_modules/ or tsx at runtime.
//
// Output:
//   dist/electron-main.mjs    (MJS bundle — entry point for packaged app)
//   dist/electron-preload.js (CJS bundle — loaded via BrowserWindow preload)
//
// `electron` and `node-pty` are external (provided by the runtime / staged
// separately via stage-native-deps).
import { build } from 'esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distDir = resolve(root, 'dist')
mkdirSync(distDir, { recursive: true })

const mainEntry = resolve(root, 'electron/main.ts')
const mainOut = resolve(distDir, 'electron-main.mjs')
const preloadEntry = resolve(root, 'electron/preload.ts')
const preloadOut = resolve(distDir, 'electron-preload.js')

const external = ['electron', 'node-pty', 'get-windows', 'fs']
// Production bundles bake packaged=true so unpackaged `electron .` still
// behaves like a packaged build. Dev bundles (`--dev`) leave the env alone
// so HERMES_DESKTOP_DEV_SERVER / source-tree resolution keep working.
const isDev = process.argv.includes('--dev')
const sku =
  process.env.HERMES_DESKTOP_SKU === 'bot-ssh-only'
    ? 'bot-ssh-only'
    : process.env.HERMES_DESKTOP_SKU === 'bot' || process.env.HERMES_DESKTOP_PRODUCT === 'bot'
      ? 'bot'
      : 'hermes'
const linkTitleIntegration = resolve(
  root,
  sku === 'bot-ssh-only' ? 'electron/link-title-integration.disabled.ts' : 'electron/link-title-integration.full.ts'
)
const preloadSkuIntegration = resolve(
  root,
  sku === 'bot-ssh-only' ? 'electron/sku-integrations.preload.disabled.ts' : 'electron/sku-integrations.preload.full.ts'
)
const mainSkuIntegration = resolve(
  root,
  sku === 'bot-ssh-only' ? 'electron/sku-integrations.disabled.ts' : 'electron/sku-integrations.full.ts'
)
const windowsSandboxIntegration = resolve(
  root,
  sku === 'bot-ssh-only'
    ? 'electron/sku-integrations.windows-sandbox.disabled.ts'
    : 'electron/sku-integrations.windows-sandbox.full.ts'
)
const ipcChannelPolicy = resolve(
  root,
  sku === 'bot-ssh-only' ? 'electron/ipc-channel-policy.ssh-only.ts' : 'electron/ipc-channel-policy.ts'
)
const bootstrapIntegration = resolve(root, 'electron/sku-integrations.bootstrap.disabled.ts')
const orgoBrokerIntegration = resolve(root, 'electron/sku-integrations.orgo-broker.disabled.ts')
const orgoDesktopIntegration = resolve(root, 'electron/sku-integrations.orgo-desktop.disabled.ts')
const nativeAuthIntegration = resolve(root, 'electron/sku-integrations.native-auth.disabled.ts')
const nativeOauthIntegration = resolve(root, 'electron/sku-integrations.native-oauth.disabled.ts')
const nativeOauthLoginIntegration = resolve(root, 'electron/sku-integrations.native-oauth-login.disabled.ts')
const nativeTokenStoreIntegration = resolve(root, 'electron/sku-integrations.native-token-store.disabled.ts')
const oauthNetIntegration = resolve(root, 'electron/sku-integrations.oauth-net.disabled.ts')
const skuIntegrationAliases = {
  './link-title-integration': linkTitleIntegration,
  './sku-integrations.preload': preloadSkuIntegration,
  './sku-integrations': mainSkuIntegration,
  './sku-integrations.windows-sandbox': windowsSandboxIntegration,
  './ipc-channel-policy': ipcChannelPolicy,
  ...(sku === 'bot-ssh-only'
    ? {
        './bootstrap-runner': bootstrapIntegration,
        './orgo-broker': orgoBrokerIntegration,
        './orgo-desktop': orgoDesktopIntegration,
        './native-auth-decisions': nativeAuthIntegration,
        './native-oauth': nativeOauthIntegration,
        './native-oauth-login': nativeOauthLoginIntegration,
        './native-token-store': nativeTokenStoreIntegration,
        './oauth-net-request': oauthNetIntegration
      }
    : {})
}
const skuIntegrationPlugin = {
  name: 'desktop-sku-integrations',
  setup(build) {
    build.onResolve({ filter: /^\.\/link-title-integration$/ }, args => ({
      path: skuIntegrationAliases[args.path]
    }))
    build.onResolve({ filter: /^\.\/sku-integrations\.preload$/ }, args => ({
      path: skuIntegrationAliases[args.path]
    }))
    build.onResolve({ filter: /^\.\/sku-integrations$/ }, args => ({
      path: skuIntegrationAliases[args.path]
    }))
    build.onResolve({ filter: /^\.\/sku-integrations\.windows-sandbox$/ }, args => ({
      path: skuIntegrationAliases[args.path]
    }))
    build.onResolve({ filter: /^\.\/ipc-channel-policy$/ }, args => ({
      path: skuIntegrationAliases[args.path]
    }))
    if (sku === 'bot-ssh-only') {
      build.onResolve({ filter: /^\.\/bootstrap-runner$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/orgo-broker$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/orgo-desktop$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/native-auth-decisions$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/native-oauth$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/native-oauth-login$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/native-token-store$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
      build.onResolve({ filter: /^\.\/oauth-net-request$/ }, args => ({ path: skuIntegrationAliases[args.path] }))
    }
  }
}
const define = isDev
  ? {}
  : {
      'process.env.HERMES_DESKTOP_IS_PACKAGED': JSON.stringify(true),
      'process.env.HERMES_DESKTOP_SKU': JSON.stringify(sku),
      'process.env.HERMES_DESKTOP_PRODUCT': JSON.stringify(sku === 'hermes' ? 'hermes' : 'bot')
    }

if (!isDev && sku !== 'hermes') {
  define['process.env.HERMES_DESKTOP_PRODUCT'] = JSON.stringify('bot')
  define['process.env.HERMES_DESKTOP_APP_NAME'] = JSON.stringify('Korgo Bot')
}

// Bundle main.ts → dist/electron-main.mjs
await build({
  entryPoints: [mainEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: mainOut,
  minifyIdentifiers: !isDev,
  minifySyntax: !isDev,
  external,
  plugins: [skuIntegrationPlugin],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  },
  define,
  logLevel: 'info'
})
console.log(`bundled ${mainOut}${isDev ? ' (dev)' : ''}`)

// Bundle preload.ts → dist/electron-preload.js
await build({
  entryPoints: [preloadEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: preloadOut,
  minifyIdentifiers: !isDev,
  minifySyntax: !isDev,
  external,
  plugins: [skuIntegrationPlugin],
  define,
  logLevel: 'info'
})
console.log(`bundled ${preloadOut}${isDev ? ' (dev)' : ''}`)
