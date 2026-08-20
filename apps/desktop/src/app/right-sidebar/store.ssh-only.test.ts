import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/product-capabilities', () => ({
  allowsDesktopCapability: (capability: string) => capability !== 'allowOrgo'
}))

vi.mock('@/lib/product', () => ({
  isBotProduct: () => true
}))

describe('SSH-only computer store policy', () => {
  it('cannot restore, open, or request the Orgo computer surface', async () => {
    window.localStorage.setItem('hermes.desktop.orgoDesktop.open.v1', 'true')

    const {
      $orgoDesktopOpen,
      $orgoDesktopSettingsRequest,
      requestOrgoDesktopSettings,
      setOrgoDesktopOpen
    } = await import('./store')

    expect($orgoDesktopOpen.get()).toBe(false)
    expect($orgoDesktopSettingsRequest.get()).toBe(false)

    setOrgoDesktopOpen(true)
    requestOrgoDesktopSettings()

    expect($orgoDesktopOpen.get()).toBe(false)
    expect($orgoDesktopSettingsRequest.get()).toBe(false)
  })
})
