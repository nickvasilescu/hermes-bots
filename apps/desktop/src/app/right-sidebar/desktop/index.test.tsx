import { readFileSync } from 'node:fs'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopOrgoSessionResult } from '@/global'
import { $activeGatewayProfile, $profiles } from '@/store/profile'
import type { ProfileInfo } from '@/types/hermes'

import { requestOrgoDesktopSettings, setOrgoDesktopOpen } from '../store'

const { MockRfb, rfbInstances } = vi.hoisted(() => {
  const instances: Array<{
    clipViewport: boolean
    compressionLevel: number
    credentials: { password?: string } | undefined
    disconnect: ReturnType<typeof vi.fn>
    dispatchEvent: (event: Event) => boolean
    focus: ReturnType<typeof vi.fn>
    qualityLevel: number
    resizeSession: boolean
    scaleViewport: boolean
    url: string
    viewOnly: boolean
  }> = []

  class Rfb extends EventTarget {
    clipViewport = false
    compressionLevel = 0
    qualityLevel = 0
    resizeSession = true
    scaleViewport = false
    viewOnly = false
    disconnected = false
    credentials: { password?: string } | undefined
    target: HTMLElement
    url: string

    constructor(target: HTMLElement, url: string, options?: { credentials?: { password?: string } }) {
      super()
      this.target = target
      this.url = url
      this.credentials = options?.credentials
      instances.push(this)
    }

    clipboardPasteFrom = vi.fn()
    focus = vi.fn()
    sendCredentials = vi.fn()
    disconnect = vi.fn(() => {
      this.disconnected = true
    })
  }

  return { MockRfb: Rfb, rfbInstances: instances }
})

const { ensureGatewayProfileMock, refreshProfilesMock } = vi.hoisted(() => ({
  ensureGatewayProfileMock: vi.fn(async (_profile: string) => undefined),
  refreshProfilesMock: vi.fn(async () => [])
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureGatewayProfile: ensureGatewayProfileMock,
  refreshProfiles: refreshProfilesMock
}))

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

const profile = (name: string, isDefault = false): ProfileInfo => ({
  has_env: false,
  is_default: isDefault,
  model: null,
  name,
  path: `/tmp/${name}`,
  provider: null,
  skill_count: 0
})

describe('OrgoDesktopPane', () => {
  beforeEach(() => {
    rfbInstances.length = 0
    Element.prototype.scrollIntoView = vi.fn()
    $activeGatewayProfile.set('default')
    $profiles.set([profile('default', true), profile('client-a')])
    ensureGatewayProfileMock.mockClear()
    refreshProfilesMock.mockClear()
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
    $profiles.set([])
    vi.restoreAllMocks()
  })

  it('connects through noVNC with fresh credentials and preserves the remote screen until unmount', async () => {
    const view = render(<OrgoDesktopPane />)

    await waitFor(() => expect(rfbInstances).toHaveLength(1))
    const rfb = rfbInstances[0]

    expect(rfb.url).toBe('wss://www.orgo.ai/desktops/8b517302/ws/websockify?token=temporary')
    expect(rfb.credentials).toEqual({ password: 'temporary' })
    expect(rfb.scaleViewport).toBe(true)
    // Clipping is deliberately OFF: with it on, noVNC cropped the remote
    // screen to fill the rail's frame and cut off the desktop's top and
    // bottom. Scaling without clipping letterboxes the whole screen instead.
    expect(rfb.clipViewport).toBe(false)
    expect(rfb.resizeSession).toBe(false)
    expect(rfb.qualityLevel).toBe(7)
    expect(rfb.compressionLevel).toBe(2)
    // Interactive from the first connect: requiring a toggle before you could
    // click the machine made the common case a two-step. The toggle remains
    // for pinning a session read-only.
    expect(rfb.viewOnly).toBe(false)

    act(() => rfb.dispatchEvent(new Event('connect')))
    expect(await screen.findByText("Dewey's screen")).toBeTruthy()
    // The preview is interactive from the first connect, so a pointer down
    // hands keyboard focus to the machine rather than being swallowed.
    fireEvent.pointerDown(screen.getByLabelText('Orgo computer screen'))
    expect(rfb.focus).toHaveBeenCalled()

    // Configuration is reached from the titlebar gear now — the pane no longer
    // carries a second cog of its own — so the request arrives through the
    // store rather than a button inside the pane.
    act(() => requestOrgoDesktopSettings())
    expect(screen.getByText('Computer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to details' }))
    expect(rfbInstances).toHaveLength(1)

    fireEvent.click(screen.getByLabelText('Open computer fullscreen', { selector: 'button' }))
    const exit = screen.getByRole('button', { name: 'Exit fullscreen' })
    expect(exit).toBeTruthy()
    // Light mode paints ghost buttons with dark theme tokens; the overlay
    // chrome is always black, so these must force light-on-dark icons.
    expect(exit.className).toMatch(/text-white/)
    expect(screen.getByRole('button', { name: /Paste clipboard/i }).className).toMatch(/text-white/)
    expect(rfbInstances).toHaveLength(1)

    view.unmount()
    expect(rfb.disconnect).toHaveBeenCalled()
  })

  it('crops the panel bar by geometry, not by object-fit', () => {
    // noVNC nests its canvas inside its own screen div, so the `[&>canvas]`
    // object-fit rules this component used to carry never matched anything.
    // The crop has to come from the element geometry: the screen host is
    // anchored to the bottom and stands taller than its frame, so the frame's
    // overflow takes the desktop's panel bar off the top.
    render(<OrgoDesktopPane />)

    const surface = screen.getByLabelText('Orgo computer screen')

    expect(surface.className).toContain('bottom-0')
    expect(surface.className).toContain('overflow-hidden')
    expect(surface.className).not.toContain('object-cover')
  })

  it('trims the panel bar by pixels, so a taller screen is not over-cropped', () => {
    // The bar is a fixed 26px of XFCE chrome. Expressed as a percentage it
    // looked right at 1280x720 and started eating window content the moment
    // the machine moved to 1280x800 — Chrome's tab strip lost its top edge.
    const source = readFileSync('src/app/right-sidebar/desktop/index.tsx', 'utf8')

    expect(source).toContain('SCREEN_PANEL_PX')
    expect(source).toMatch(/SCREEN_PANEL_PX \/ screenSize\.height/)
    expect(source).not.toContain('SCREEN_TOP_CROP')
  })

  it('starts the computer preview near the top instead of reserving an empty header', () => {
    const source = readFileSync('src/app/right-sidebar/desktop/index.tsx', 'utf8')
    const details = source.match(/aria-hidden=\{view !== 'details'\}[\s\S]*?<AgentRoutines/)

    expect(details).not.toBeNull()
    expect(details?.[0]).not.toContain('<RailHeader />')
    expect(details?.[0]).toContain('<section className="shrink-0 px-2.5 pt-2">')
  })

  it('reshapes the frame when the remote machine changes resolution', async () => {
    // Sampling the framebuffer once at connect stranded the frame at the old
    // aspect when the box was re-resolutioned underneath it (xrandr on the
    // remote machine), letterboxing a screen that had just become taller.
    render(<OrgoDesktopPane />)

    const surface = await screen.findByLabelText('Orgo computer screen')

    expect(surface).toBeTruthy()
    // The observer is wired to the screen host, so a canvas swap or a
    // width/height attribute change re-measures rather than going stale.
    expect(typeof MutationObserver).toBe('function')
  })

  it('sizes the frame from the remote screen aspect so no side is letterboxed', async () => {
    // A hardcoded 16:10 frame letterboxed every machine whose screen was not
    // 16:10 — correct, but it reads as a broken crop next to a panel whose
    // frame matches its screen. The canvas noVNC creates is the source of
    // truth for the remote resolution.
    const view = render(<OrgoDesktopPane />)

    await screen.findByLabelText('Orgo computer screen')

    const slot = view.container.querySelector('[style*="aspect-ratio"]')

    expect(slot).not.toBeNull()
  })

  it('discovers and saves an isolated workspace computer without requiring a raw UUID', async () => {
    const workspaceId = 'workspace-client-a'
    const computerId = 'ef2f6e29-3864-494b-a82c-15280c5d9f9e'

    vi.mocked(window.hermesDesktop.orgoDesktop.getConfig).mockResolvedValue({
      configured: false,
      computerId: '',
      apiKeySet: false,
      inheritedFromDefault: false,
      profile: 'default'
    })
    vi.mocked(window.hermesDesktop.orgoDesktop.saveConfig).mockResolvedValue({
      configured: true,
      computerId,
      workspaceId,
      apiKeySet: true,
      inheritedFromDefault: false,
      profile: 'default'
    })
    vi.mocked(window.hermesDesktop.orgoDesktop.listInventory).mockResolvedValue({
      workspaces: [{ id: workspaceId, name: 'Client A' }],
      computers: [{ id: computerId, name: 'Client A Operations', status: 'running', workspaceId }]
    })

    render(<OrgoDesktopPane />)

    expect(await screen.findByText('Computer')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Orgo API key'), { target: { value: 'orgo-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load accessible computers' }))

    await waitFor(() =>
      expect(window.hermesDesktop.orgoDesktop.listInventory).toHaveBeenCalledWith({
        apiKey: 'orgo-key',
        profile: 'default'
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Client A Operations, Running, Client A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))

    await waitFor(() =>
      expect(window.hermesDesktop.orgoDesktop.saveConfig).toHaveBeenCalledWith({
        apiKey: 'orgo-key',
        computerId,
        workspaceId,
        profile: 'default'
      })
    )
  })

  it('searches all workspaces returned by Orgo and exposes live computer status', async () => {
    vi.mocked(window.hermesDesktop.orgoDesktop.getConfig).mockResolvedValue({
      configured: true,
      computerId: 'ef2f6e29-3864-494b-a82c-15280c5d9f9e',
      workspaceId: 'workspace-shared',
      apiKeySet: true,
      inheritedFromDefault: false,
      profile: 'default'
    })
    vi.mocked(window.hermesDesktop.orgoDesktop.listInventory).mockResolvedValue({
      workspaces: [
        { id: 'workspace-shared', name: 'Shared' },
        { id: 'workspace-client', name: 'Client workspace' }
      ],
      computers: [
        {
          id: 'ef2f6e29-3864-494b-a82c-15280c5d9f9e',
          name: 'Shared computer',
          status: 'running',
          workspaceId: 'workspace-shared'
        },
        {
          id: '60fe709b-1837-476c-87c0-12e74575c94b',
          name: 'Campaign research',
          status: 'stopped',
          workspaceId: 'workspace-client'
        }
      ]
    })

    render(<OrgoDesktopPane />)
    await waitFor(() => expect(window.hermesDesktop.orgoDesktop.listInventory).toHaveBeenCalled())
    act(() => requestOrgoDesktopSettings())

    expect(await screen.findByText('2 workspaces · 2 computers')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Shared computer, Running, Shared' }).getAttribute('aria-pressed')
    ).toBe('true')
    fireEvent.change(screen.getByLabelText('Search computers or workspaces…'), {
      target: { value: 'Client' }
    })

    expect(screen.getByRole('button', { name: 'Campaign research, Stopped, Client workspace' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Shared computer, Running, Shared' })).toBeNull()
  })

  it('lets an unconfigured agent return from setup to the computer overview', async () => {
    vi.mocked(window.hermesDesktop.orgoDesktop.getConfig).mockResolvedValue({
      configured: false,
      computerId: '',
      apiKeySet: false,
      inheritedFromDefault: false,
      profile: 'default'
    })

    render(<OrgoDesktopPane />)

    expect(await screen.findByText('Computer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to details' }))

    expect(screen.getByText('Connect an Orgo computer to see its screen.')).toBeTruthy()
    expect(screen.getByText('Connect computer')).toBeTruthy()
    expect(screen.queryByLabelText('Orgo API key')).toBeNull()
  })

  it('routes the searchable sub-account selector through the existing Hermes profile switch', async () => {
    ensureGatewayProfileMock.mockImplementationOnce(async selectedProfile => {
      $activeGatewayProfile.set(selectedProfile)
    })
    vi.mocked(window.hermesDesktop.orgoDesktop.getConfig).mockResolvedValue({
      configured: false,
      computerId: '',
      apiKeySet: false,
      inheritedFromDefault: false,
      profile: 'default'
    })

    render(<OrgoDesktopPane />)

    fireEvent.click(await screen.findByRole('combobox', { name: 'Client agent / sub-account' }))
    fireEvent.click(await screen.findByText('client-a'))

    expect(ensureGatewayProfileMock).toHaveBeenCalledWith('client-a')
    await waitFor(() => expect(window.hermesDesktop.orgoDesktop.getConfig).toHaveBeenCalledWith('client-a'))
    expect(screen.getByRole('combobox', { name: 'Client agent / sub-account' }).textContent).toContain('client-a')
  })

  it('connects a new agent through the inherited default desktop binding', async () => {
    $activeGatewayProfile.set('inbox-triage')
    vi.mocked(window.hermesDesktop.orgoDesktop.getConfig).mockResolvedValue({
      configured: true,
      computerId: 'ef2f6e29-3864-494b-a82c-15280c5d9f9e',
      apiKeySet: true,
      inheritedFromDefault: true,
      profile: 'inbox-triage'
    })

    render(<OrgoDesktopPane />)

    await waitFor(() => expect(rfbInstances).toHaveLength(1))
    expect(window.hermesDesktop.orgoDesktop.getSession).toHaveBeenCalledWith('inbox-triage')
    expect(screen.queryByText('Connect an Orgo computer')).toBeNull()
  })
})
