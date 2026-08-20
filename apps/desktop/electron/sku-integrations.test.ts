import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  registerMarketplaceThemeHandlers as disabledMarketplaceRegistrar,
  registerSkuIntegrations as disabledRegistrar
} from './sku-integrations.disabled'
import {
  registerMarketplaceThemeHandlers as fullMarketplaceRegistrar,
  registerSkuIntegrations as fullRegistrar
} from './sku-integrations.full'

describe('SKU integration registration', () => {
  test('SSH-only integration has no registrar or credential-accepting stub', () => {
    assert.equal(disabledRegistrar, undefined)
    assert.equal(disabledMarketplaceRegistrar, undefined)
  })

  test('full integration intentionally registers the existing handlers', () => {
    let registrations = 0
    fullRegistrar(() => {
      registrations += 1
    })
    assert.equal(registrations, 1)
  })

  test('full product registers marketplace handlers outside the SSH bundle graph', () => {
    const channels: string[] = []
    fullMarketplaceRegistrar({
      handle: channel => {
        channels.push(channel)
      }
    })
    assert.deepEqual(channels, ['hermes:vscode-theme:fetch', 'hermes:vscode-theme:search'])
  })
})
