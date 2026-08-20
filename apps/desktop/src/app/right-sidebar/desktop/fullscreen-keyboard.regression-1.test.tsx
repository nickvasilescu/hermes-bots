import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopOrgoSessionResult } from '@/global'
import { composerFocusKeysAllowed } from '@/lib/keybinds/composer-focus-keys'
import { $activeGatewayProfile } from '@/store/profile'

import { setOrgoDesktopOpen } from '../store'

const { MockRfb, rfbInstances } = vi.hoisted(() => {
  const instances: Array<{
    dispatchEvent: (event: Event) => boolean
    focus: ReturnType<typeof vi.fn>
  }> = []

  class Rfb extends EventTarget {
    clipViewport = false
    compressionLevel = 0
    qualityLevel = 0
    resizeSession = true
    scaleViewport = false
    viewOnly = false

    constructor() {
      super()
      instances.push(this)
    }

    clipboardPasteFrom = vi.fn()
    disconnect = vi.fn()
    focus = vi.fn()
    sendCredentials = vi.fn()
  }

  return { MockRfb: Rfb, rfbInstances: instances }
})

vi.mock('@novnc/novnc', () => ({ default: MockRfb }))

import { OrgoDesktopPane } from './index'

const SESSION: DesktopOrgoSessionResult = {
  ok: true,
  computerId: 'ef2f6e29-3864-494b-a82c-15280c5d9f9e',
  computerName: 'Dewey',
  instanceId: '8b517302',
  status: 'running',
  websocketUrl: 'wss://www.orgo.ai/desktops/8b517302/ws/websockify?token=temporary',
  password: 'temporary'
}

describe('Orgo fullscreen keyboard ownership', () => {
  beforeEach(() => {
    rfbInstances.length = 0
    $activeGatewayProfile.set('default')
    setOrgoDesktopOpen(true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      }
    )
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        api: vi.fn().mockResolvedValue([]),
        getConnectionConfig: vi.fn().mockResolvedValue({ mode: 'ssh', profile: null }),
        orgoDesktop: {
          getConfig: vi.fn().mockResolvedValue({
            configured: true,
            computerId: SESSION.ok ? SESSION.computerId : '',
            apiKeySet: true,
            inheritedFromDefault: false,
            profile: 'default'
          }),
          getSession: vi.fn().mockResolvedValue(SESSION),
          listInventory: vi.fn().mockResolvedValue({ computers: [], workspaces: [] }),
          listComputers: vi.fn().mockResolvedValue([]),
          listWorkspaces: vi.fn().mockResolvedValue([]),
          saveConfig: vi.fn(),
          clearConfig: vi.fn()
        },
        writeClipboard: vi.fn().mockResolvedValue(true)
      }
    })
  })

  afterEach(() => {
    cleanup()
    setOrgoDesktopOpen(false)
    $activeGatewayProfile.set('default')
    vi.restoreAllMocks()
  })

  // Regression: ISSUE-001 — fullscreen remote typing was stolen by the chat composer
  // Found by /qa on 2026-08-20
  // Report: .gstack/qa-reports/qa-report-korgo-bot-2026-08-20.md
  it('makes the fullscreen computer own printable keys before noVNC handles them', async () => {
    render(<OrgoDesktopPane />)

    await waitFor(() => expect(rfbInstances).toHaveLength(1))
    act(() => rfbInstances[0].dispatchEvent(new Event('connect')))

    fireEvent.click(screen.getByLabelText('Open computer fullscreen', { selector: 'button' }))

    const remoteScreen = screen.getByLabelText('Orgo computer screen')
    const overlay = remoteScreen.closest('[data-overlay-surface]')
    const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Q' })

    Object.defineProperty(key, 'target', { value: remoteScreen })

    expect(overlay).not.toBeNull()
    expect(composerFocusKeysAllowed(key, 'type')).toBe(false)

    fireEvent.pointerDown(remoteScreen)
    expect(rfbInstances[0].focus).toHaveBeenCalled()
  })
})
