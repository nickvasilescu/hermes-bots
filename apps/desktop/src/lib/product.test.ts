import { describe, expect, it } from 'vitest'

import {
  allowsGenericHermesUpdates,
  BOT_APP_ICON_ASSET,
  BOT_APP_NAME,
  BOT_PROVIDER_IDS,
  BOT_UPDATE_POLICY,
  DESKTOP_SKU,
  desktopSku,
  filterBotProviders,
  isBotProduct,
  isBotProviderId,
  isSshOnlyProduct
} from './product'
import {
  DESKTOP_CAPABILITY_NAMES,
  DESKTOP_CONNECTION_MODES,
  desktopCapabilitiesForSku,
  FULL_DESKTOP_POLICY,
  SSH_ONLY_POLICY
} from './product-capabilities'

describe('bot product providers', () => {
  it('uses the Korgo Bot display identity', () => {
    expect(BOT_APP_NAME).toBe('Korgo Bot')
    expect(BOT_APP_ICON_ASSET).toBe('korgo-bot-icon.png')
  })

  it('recognizes Codex and Grok only', () => {
    expect(isBotProviderId('openai-codex')).toBe(true)
    expect(isBotProviderId('xai-oauth')).toBe(true)
    expect(isBotProviderId('nous')).toBe(false)
    expect(BOT_PROVIDER_IDS).toHaveLength(2)
  })

  it('filters to Codex and Grok only in the Bot SKU', () => {
    const providers = [{ id: 'nous' }, { id: 'openai-codex' }, { id: 'xai-oauth' }]
    const filtered = isBotProduct() ? filterBotProviders(providers) : providers.filter(p => isBotProviderId(p.id))
    expect(filtered.map(p => p.id)).toEqual(['openai-codex', 'xai-oauth'])
  })

  it('uses release-level updates for the Bot SKU', () => {
    expect(BOT_UPDATE_POLICY).toBe('source-release')
    expect(allowsGenericHermesUpdates()).toBe(!isBotProduct())
  })

  it('exposes one immutable compile-time SKU', () => {
    expect(desktopSku()).toBe(DESKTOP_SKU)
    expect(isBotProduct()).toBe(DESKTOP_SKU !== 'hermes')
    expect(isSshOnlyProduct()).toBe(DESKTOP_SKU === 'bot-ssh-only')
  })

  it('does not let a runtime environment mutation widen the captured policy', () => {
    const env = import.meta.env as unknown as Record<string, string | undefined>
    const originalSku = env.VITE_HERMES_DESKTOP_SKU
    const originalProduct = env.VITE_HERMES_DESKTOP_PRODUCT
    const capturedSku = desktopSku()
    const capturedPolicy = desktopCapabilitiesForSku(capturedSku)

    try {
      env.VITE_HERMES_DESKTOP_SKU = capturedSku === 'bot-ssh-only' ? 'hermes' : 'bot-ssh-only'
      env.VITE_HERMES_DESKTOP_PRODUCT = capturedSku === 'hermes' ? 'bot' : 'hermes'
      expect(desktopSku()).toBe(capturedSku)
      expect(desktopCapabilitiesForSku(desktopSku())).toBe(capturedPolicy)
    } finally {
      env.VITE_HERMES_DESKTOP_SKU = originalSku
      env.VITE_HERMES_DESKTOP_PRODUCT = originalProduct
    }
  })

  it('keeps full and bot policy while the SSH-only SKU rejects every forbidden capability', () => {
    for (const sku of ['hermes', 'bot'] as const) {
      expect(desktopCapabilitiesForSku(sku)).toBe(FULL_DESKTOP_POLICY)
      expect(desktopCapabilitiesForSku(sku).allowedConnectionModes).toEqual(DESKTOP_CONNECTION_MODES)
    }

    expect(desktopCapabilitiesForSku('bot-ssh-only')).toBe(SSH_ONLY_POLICY)
    expect(SSH_ONLY_POLICY.allowedConnectionModes).toEqual(['ssh'])

    for (const capability of DESKTOP_CAPABILITY_NAMES) {
      expect(SSH_ONLY_POLICY[capability]).toBe(false)
    }
  })
})
