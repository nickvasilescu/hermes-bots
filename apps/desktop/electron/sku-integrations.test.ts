import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { registerSkuIntegrations as disabledRegistrar } from './sku-integrations.disabled'
import { registerSkuIntegrations as fullRegistrar } from './sku-integrations.full'

describe('SKU integration registration', () => {
  test('SSH-only integration has no registrar or credential-accepting stub', () => {
    assert.equal(disabledRegistrar, undefined)
  })

  test('full integration intentionally registers the existing handlers', () => {
    let registrations = 0
    fullRegistrar(() => {
      registrations += 1
    })
    assert.equal(registrations, 1)
  })
})
