import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createSkuPreloadBridge as createSshOnlyBridge } from './sku-integrations.preload.disabled'
import { createSkuPreloadBridge as createFullBridge } from './sku-integrations.preload.full'

const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  on: () => undefined,
  removeListener: () => undefined
} as any

test('SSH-only preload exposes only the main-owned gateway proxy integration', () => {
  const bridge = createSshOnlyBridge(ipcRenderer)
  assert.deepEqual(Object.keys(bridge), ['gatewayProxy'])
  assert.equal(typeof bridge.gatewayProxy.start, 'function')
  assert.equal(typeof bridge.gatewayProxy.send, 'function')
  assert.equal(typeof bridge.gatewayProxy.close, 'function')
  assert.equal(typeof bridge.gatewayProxy.onEvent, 'function')

  for (const property of [
    'getGatewayWsUrl',
    'orgoDesktop',
    'connectors',
    'cloud',
    'oauthLoginConnectionConfig',
    'fetchLinkTitle',
    'getBootstrapState',
    'themes',
    'updates',
    'uninstall'
  ]) {
    assert.equal(bridge[property], undefined)
  }
})

test('full-product preload retains its integration surface', () => {
  const bridge = createFullBridge(ipcRenderer)
  assert.equal(typeof bridge.getGatewayWsUrl, 'function')
  assert.equal('gatewayProxy' in bridge, false)
  assert.equal(typeof bridge.orgoDesktop.saveKey, 'function')
  assert.equal(typeof bridge.connectors.saveKey, 'function')
  assert.equal(typeof bridge.cloud.login, 'function')
  assert.equal(typeof bridge.oauthLoginConnectionConfig, 'function')
  assert.equal(typeof bridge.fetchLinkTitle, 'function')
  assert.equal(typeof bridge.getBootstrapState, 'function')
  assert.equal(typeof bridge.themes.fetchMarketplace, 'function')
  assert.equal(typeof bridge.themes.searchMarketplace, 'function')
  assert.equal(typeof bridge.updates.apply, 'function')
  assert.equal(typeof bridge.uninstall.run, 'function')
})
