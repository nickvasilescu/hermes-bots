import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const policy = vi.hoisted(() => ({ orgoAllowed: false }))
const openComputerSettings = vi.hoisted(() => vi.fn())

vi.mock('@/lib/product', () => ({ isBotProduct: () => true }))
vi.mock('@/lib/product-capabilities', () => ({
  allowsDesktopCapability: (capability: string) => capability !== 'allowOrgo' || policy.orgoAllowed
}))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: ReactNode }) => children,
  TipKeybindLabel: ({ text }: { text: string }) => text
}))
vi.mock('../right-sidebar/store', async () => {
  const { atom } = await import('nanostores')

  return {
    $orgoDesktopOpen: atom(false),
    requestOrgoDesktopSettings: openComputerSettings,
    setOrgoDesktopOpen: vi.fn()
  }
})

import { TitlebarControls } from './titlebar-controls'

beforeEach(() => {
  policy.orgoAllowed = false
})

afterEach(() => {
  cleanup()
  openComputerSettings.mockClear()
})

describe('SSH-only titlebar policy', () => {
  it('reuses the gear for safe app settings and removes computer actions', () => {
    const onOpenSettings = vi.fn()

    render(
      <MemoryRouter>
        <TitlebarControls onOpenSettings={onOpenSettings} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Show computer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Configure computer' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(openComputerSettings).not.toHaveBeenCalled()
  })

  it('retains computer controls for full products', () => {
    policy.orgoAllowed = true
    const onOpenSettings = vi.fn()

    render(
      <MemoryRouter>
        <TitlebarControls onOpenSettings={onOpenSettings} />
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: 'Show computer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Configure computer' }))

    expect(openComputerSettings).toHaveBeenCalledOnce()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })
})
