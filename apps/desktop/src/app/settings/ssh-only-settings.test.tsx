import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const product = vi.hoisted(() => ({ sshOnly: true }))
const openConnectors = vi.hoisted(() => vi.fn())

vi.mock('@/lib/product', () => ({
  isSshOnlyProduct: () => product.sshOnly
}))

vi.mock('@/hermes', () => ({
  getHermesConfigDefaults: vi.fn(),
  getHermesConfigRecord: vi.fn(),
  saveHermesConfig: vi.fn()
}))

vi.mock('../connectors/store', () => ({ openConnectors }))

vi.mock('../overlays/overlay-chrome', () => ({
  OverlayIconButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>
}))

vi.mock('../overlays/overlay-split-layout', () => ({
  OverlayMain: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  OverlayNav: ({ footer, groups }: { footer?: ReactNode; groups: Array<{ id: string; label: string }> }) => (
    <nav>
      {groups.map(group => (
        <span data-settings-nav={group.id} key={group.id}>
          {group.label}
        </span>
      ))}
      {footer ? <span data-testid="settings-footer" /> : null}
    </nav>
  ),
  OverlaySplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../overlays/overlay-view', () => ({
  OverlayView: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('./about-settings', () => ({ AboutSettings: () => <div>about-panel</div> }))
vi.mock('./appearance-settings', () => ({ AppearanceSettings: () => <div>appearance-panel</div> }))
vi.mock('./billing', () => ({ BillingSettings: () => <div>billing-panel</div> }))
vi.mock('./config-settings', () => ({
  ConfigSettings: ({ activeSectionId }: { activeSectionId: string }) => <div>config-panel:{activeSectionId}</div>
}))
vi.mock('./gateway-settings', () => ({ GatewaySettings: () => <div>gateway-panel</div> }))
vi.mock('./keybind-settings', () => ({ KeybindSettings: () => <div>keybind-panel</div> }))
vi.mock('./keys-settings', () => ({
  KEYS_VIEWS: ['tools', 'settings'],
  KeysSettings: () => <div>keys-panel</div>
}))
vi.mock('./notifications-settings', () => ({ NotificationsSettings: () => <div>notifications-panel</div> }))
vi.mock('./providers-settings', () => ({
  PROVIDER_VIEWS: ['accounts', 'keys', 'custom-endpoints'],
  ProvidersSettings: () => <div>providers-panel</div>
}))
vi.mock('./sessions-settings', () => ({ SessionsSettings: () => <div>sessions-panel</div> }))

import { resolveSettingsView, SettingsView, settingsViewsForProduct } from './index'

function LocationProbe() {
  const location = useLocation()

  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderSettings(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SettingsView onClose={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>
  )
}

beforeEach(() => {
  product.sshOnly = true
})

afterEach(() => {
  cleanup()
  openConnectors.mockClear()
})

describe('SSH-only settings policy', () => {
  it('keeps only presentation and session settings in the SSH SKU', () => {
    expect(settingsViewsForProduct(true)).toEqual([
      'config:appearance',
      'config:chat',
      'keybinds',
      'notifications',
      'sessions',
      'about'
    ])

    expect(resolveSettingsView('providers', true)).toBe('config:appearance')
    expect(resolveSettingsView('keys', true)).toBe('config:appearance')
    expect(resolveSettingsView('config:workspace', true)).toBe('config:appearance')
    expect(resolveSettingsView('providers', false)).toBe('providers')
  })

  it('fails a provider/API-key deep link closed and removes forbidden navigation', async () => {
    renderSettings('/settings?tab=providers&pview=keys&field=OPENAI_API_KEY')

    expect(screen.getByText('appearance-panel')).toBeTruthy()
    expect(screen.queryByText('providers-panel')).toBeNull()
    expect(screen.queryByText('Providers')).toBeNull()
    expect(screen.queryByText('Gateway')).toBeNull()
    expect(screen.queryByText('Tools & Keys')).toBeNull()
    expect(screen.queryByText('Billing')).toBeNull()
    expect(screen.queryByText('Model')).toBeNull()
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.queryByTestId('settings-footer')).toBeNull()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/settings'))
  })

  it('does not turn the legacy connectors deep link into a modal action', async () => {
    renderSettings('/settings?tab=plugins')

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/settings'))
    expect(openConnectors).not.toHaveBeenCalled()
  })

  it('retains the full settings surface for non-SSH products', () => {
    product.sshOnly = false
    renderSettings('/settings?tab=providers&pview=accounts')

    expect(screen.getByText('providers-panel')).toBeTruthy()
    expect(screen.getByText('Providers')).toBeTruthy()
    expect(screen.getByText('Gateway')).toBeTruthy()
    expect(screen.getByText('Tools & Keys')).toBeTruthy()
    expect(screen.getByText('Billing')).toBeTruthy()
    expect(screen.getByTestId('settings-footer')).toBeTruthy()
  })
})
