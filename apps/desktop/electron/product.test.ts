import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  allowsGenericHermesUpdates,
  BOT_APP_ID,
  BOT_APP_NAME,
  BOT_TEMPLATE_REF,
  BOT_UPDATE_POLICY,
  DESKTOP_SKU,
  desktopAppId,
  desktopAppName,
  desktopSku,
  isBotProduct,
  isSshOnlyProduct
} from './product'
import { desktopCapabilitiesForSku, FULL_DESKTOP_POLICY } from './product-capabilities'
import { DESKTOP_CONNECTION_MODES, SSH_ONLY_CAPABILITY_NAMES, SSH_ONLY_POLICY } from './ssh-only-policy'

test('desktop identity derives from the immutable compile-time SKU', () => {
  assert.equal(BOT_APP_NAME, 'Korgo Bot')
  assert.equal(BOT_TEMPLATE_REF, 'system/hermes-agent@1.0.0')
  assert.equal(BOT_UPDATE_POLICY, 'source-release')
  assert.equal(allowsGenericHermesUpdates(), !isBotProduct())
  assert.equal(desktopSku(), DESKTOP_SKU)
  assert.equal(isSshOnlyProduct(), DESKTOP_SKU === 'bot-ssh-only')

  if (DESKTOP_SKU !== 'hermes') {
    assert.equal(isBotProduct(), true)
    assert.equal(desktopAppName(), process.env.HERMES_DESKTOP_APP_NAME || BOT_APP_NAME)
    assert.equal(desktopAppId(), BOT_APP_ID)

    return
  }

  assert.equal(isBotProduct(), false)
  assert.equal(desktopAppId(), 'com.nousresearch.hermes')
})

test('runtime environment changes cannot change the captured SKU or its capabilities', () => {
  const originalSku = process.env.HERMES_DESKTOP_SKU
  const originalProduct = process.env.HERMES_DESKTOP_PRODUCT
  const capturedSku = desktopSku()
  const capturedCapabilities = desktopCapabilitiesForSku(capturedSku)

  try {
    process.env.HERMES_DESKTOP_SKU = capturedSku === 'bot-ssh-only' ? 'hermes' : 'bot-ssh-only'
    process.env.HERMES_DESKTOP_PRODUCT = capturedSku === 'hermes' ? 'bot' : 'hermes'
    assert.equal(desktopSku(), capturedSku)
    assert.equal(desktopCapabilitiesForSku(desktopSku()), capturedCapabilities)
  } finally {
    if (originalSku === undefined) {delete process.env.HERMES_DESKTOP_SKU}
    else {process.env.HERMES_DESKTOP_SKU = originalSku}

    if (originalProduct === undefined) {delete process.env.HERMES_DESKTOP_PRODUCT}
    else {process.env.HERMES_DESKTOP_PRODUCT = originalProduct}
  }
})

test('full and bot SKUs retain the complete policy while bot-ssh-only denies every capability', () => {
  for (const sku of ['hermes', 'bot'] as const) {
    assert.equal(desktopCapabilitiesForSku(sku), FULL_DESKTOP_POLICY)
    assert.deepEqual(desktopCapabilitiesForSku(sku).allowedConnectionModes, DESKTOP_CONNECTION_MODES)
  }

  assert.equal(desktopCapabilitiesForSku('bot-ssh-only'), SSH_ONLY_POLICY)

  for (const capability of SSH_ONLY_CAPABILITY_NAMES) {
    assert.equal(desktopCapabilitiesForSku('bot-ssh-only')[capability], false)
  }
})
