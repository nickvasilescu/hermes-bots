import { useStore } from '@nanostores/react'
import type RFB from '@novnc/novnc'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { Switch } from '@/components/ui/switch'
import type { DesktopOrgoComputer, DesktopOrgoConfig, DesktopOrgoSessionResult, DesktopOrgoWorkspace } from '@/global'
import { useI18n } from '@/i18n'
import { ChevronLeft, Clipboard, Maximize, RefreshCw, X } from '@/lib/icons'
import {
  $activeGatewayProfile,
  $profiles,
  ensureGatewayProfile,
  normalizeProfileKey,
  refreshProfiles
} from '@/store/profile'
import type { CronJob } from '@/types/hermes'

import { SearchableSelect } from '../../settings/searchable-select'
import { $orgoDesktopOpen, $orgoDesktopSettingsRequest, clearOrgoDesktopSettingsRequest } from '../store'

import { AgentRoutines, RoutineEditor } from './routines'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error'
type RailView = 'details' | 'routine' | 'settings'

function agentLabel(profile: string, computerName: string): string {
  if (profile === 'default') {
    return computerName || 'Agent'
  }

  return profile.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
}

interface RailHeaderProps {
  onBack?: () => void
  title?: string
}

function RailHeader({ onBack, title }: RailHeaderProps) {
  return (
    <header className="relative flex h-9 shrink-0 items-center justify-between px-1.5">
      {onBack ? (
        <Button aria-label="Back to details" onClick={onBack} size="icon-xs" variant="ghost">
          <ChevronLeft />
        </Button>
      ) : (
        <span />
      )}
      {title ? (
        <h2 className="pointer-events-none absolute inset-x-9 truncate text-center text-[0.72rem] font-medium text-(--ui-text-secondary)">
          {title}
        </h2>
      ) : null}
      {/* No close button: the titlebar's computer toggle already opens and
          closes this pane, and two controls for one state invites the two to
          disagree. */}
      <span />
    </header>
  )
}

interface OrgoComputerPickerProps {
  computers: DesktopOrgoComputer[]
  emptyMessage: string
  formatMatches: (count: number) => string
  listLabel: string
  onSelect: (computer: DesktopOrgoComputer) => void
  scopeHint: string
  searchPlaceholder: string
  selectedComputerId: string
  summary: string
  workspaces: DesktopOrgoWorkspace[]
}

function computerStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase()

  return normalized ? normalized.replace(/(^|[-_\s])\w/g, match => match.toUpperCase()) : 'Unknown'
}

function computerStatusTone(status: string): string {
  switch (status.trim().toLowerCase()) {
    case 'running':
      return 'bg-emerald-500'

    case 'creating':

    case 'restarting':

    case 'starting':

    case 'stopping':
      return 'bg-amber-500'

    case 'error':
      return 'bg-red-500'

    default:
      return 'bg-(--ui-text-quaternary)'
  }
}

function OrgoComputerPicker({
  computers,
  emptyMessage,
  formatMatches,
  listLabel,
  onSelect,
  scopeHint,
  searchPlaceholder,
  selectedComputerId,
  summary,
  workspaces
}: OrgoComputerPickerProps) {
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()

    return [...workspaces]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(workspace => {
        const workspaceMatch = workspace.name.toLowerCase().includes(query)

        const available = computers
          .filter(computer => computer.workspaceId === workspace.id)
          .filter(computer => !query || workspaceMatch || computer.name.toLowerCase().includes(query))
          .sort((left, right) => left.name.localeCompare(right.name))

        return { available, workspace }
      })
      .filter(group => !query || group.workspace.name.toLowerCase().includes(query) || group.available.length > 0)
  }, [computers, search, workspaces])

  const resultCount = groups.reduce((count, group) => count + group.available.length, 0)

  return (
    <section className="overflow-hidden rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)">
      <div className="grid gap-1.5 border-b border-(--ui-stroke-tertiary) p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.68rem] font-medium text-(--ui-text-secondary)">{summary}</p>
          {search ? (
            <span className="text-[0.62rem] text-(--ui-text-quaternary)">{formatMatches(resultCount)}</span>
          ) : null}
        </div>
        <Input
          aria-label={searchPlaceholder}
          onChange={event => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          value={search}
        />
        <p className="text-[0.61rem] leading-3.5 text-(--ui-text-quaternary)">{scopeHint}</p>
      </div>

      <div aria-label={listLabel} className="max-h-64 overflow-y-auto p-1.5" role="list">
        {groups.length > 0 ? (
          groups.map(({ available, workspace }) => (
            <div className="py-1" key={workspace.id} role="listitem">
              <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
                <p className="truncate text-[0.62rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)">
                  {workspace.name}
                </p>
                <span className="shrink-0 text-[0.6rem] text-(--ui-text-quaternary)">{available.length}</span>
              </div>
              {available.length > 0 ? (
                <div className="grid gap-0.5">
                  {available.map(computer => {
                    const selected = computer.id === selectedComputerId
                    const status = computerStatusLabel(computer.status)

                    return (
                      <button
                        aria-label={`${computer.name}, ${status}, ${workspace.name}`}
                        aria-pressed={selected}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-focus-border) ${
                          selected
                            ? 'bg-(--ui-selection-background) text-(--ui-selection-foreground)'
                            : 'text-(--ui-text-secondary) hover:bg-(--ui-hover-background)'
                        }`}
                        key={computer.id}
                        onClick={() => onSelect(computer)}
                        type="button"
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${computerStatusTone(computer.status)}`} />
                        <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium">{computer.name}</span>
                        <span className="shrink-0 text-[0.61rem] opacity-70">{status}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="px-2 py-1 text-[0.62rem] text-(--ui-text-quaternary)">{emptyMessage}</p>
              )}
            </div>
          ))
        ) : (
          <p className="px-2 py-4 text-center text-[0.65rem] text-(--ui-text-quaternary)">{emptyMessage}</p>
        )}
      </div>
    </section>
  )
}

/** The remote desktop's panel bar, in framebuffer pixels. The preview crops
 *  exactly this much off the top: it is chrome, and it reads as a grey seam
 *  against the card. Measured in PIXELS rather than as a fraction because the
 *  bar is a fixed height — XFCE's default is 26px plus a hairline — so a
 *  percentage that looked right at 1280x720 over-cropped into the window
 *  content the moment the machine moved to 1280x800. The frame is shortened
 *  by this much and the canvas anchored to the bottom, so the bar is the only
 *  thing lost: nothing is trimmed from the sides and the dock stays visible.
 *  Fullscreen ignores it and shows the screen whole. */
const SCREEN_PANEL_PX = 28

export function OrgoDesktopPane() {
  const { t } = useI18n()
  const copy = t.rightSidebar.desktop
  const visible = useStore($orgoDesktopOpen)
  const activeProfile = normalizeProfileKey(useStore($activeGatewayProfile))
  // Some embedded/test hosts hydrate this shared atom after the pane mounts.
  // The active profile still makes a complete one-option selector meanwhile.
  const profiles = useStore($profiles) || []
  const desktopFrameRef = useRef<HTMLDivElement>(null)
  const desktopSlotRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const generationRef = useRef(0)
  const discoveryGenerationRef = useRef(0)
  const settingsProfileTargetRef = useRef<string | null>(null)
  const [config, setConfig] = useState<DesktopOrgoConfig | null>(null)
  const [workspaceId, setWorkspaceId] = useState('')
  const [computerId, setComputerId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [workspaces, setWorkspaces] = useState<DesktopOrgoWorkspace[]>([])
  const [computers, setComputers] = useState<DesktopOrgoComputer[]>([])
  const [inventoryLoaded, setInventoryLoaded] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [switchingAgent, setSwitchingAgent] = useState(false)
  const [view, setView] = useState<RailView>('details')
  const [routine, setRoutine] = useState<CronJob | null>(null)
  const [routinesRevision, setRoutinesRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [error, setError] = useState('')
  const [desktopName, setDesktopName] = useState('')
  // The remote framebuffer's pixel size. Both the frame's aspect and the crop
  // are derived from it, so a resolution change corrects the shape AND how
  // much is trimmed, instead of only one of the two.
  const [screenSize, setScreenSize] = useState<null | { height: number; width: number }>(null)
  // Interactive by default. Requiring a toggle before you could click the
  // machine made the common case — reach in and do something — a two-step,
  // and the toggle stays available for pinning it read-only.
  const [viewOnly, setViewOnly] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const [previewBounds, setPreviewBounds] = useState<{
    height: number
    left: number
    top: number
    width: number
  } | null>(null)

  const disconnect = useCallback(() => {
    generationRef.current += 1
    const rfb = rfbRef.current
    rfbRef.current = null

    if (rfb) {
      try {
        rfb.disconnect()
      } catch {
        // A failed or disposed socket is already disconnected.
      }
    }

    screenRef.current?.replaceChildren()
    setState('disconnected')
  }, [])

  // noVNC sizes its canvas to the framebuffer, so the canvas attributes are the
  // authoritative remote resolution. Read them rather than guessing an aspect.
  const measureScreenAspect = useCallback(() => {
    const canvas = screenRef.current?.querySelector('canvas')

    if (canvas?.width && canvas.height) {
      setScreenSize(previous =>
        previous?.width === canvas.width && previous.height === canvas.height
          ? previous
          : { height: canvas.height, width: canvas.width }
      )
    }
  }, [])

  const connect = useCallback(async () => {
    const target = screenRef.current

    if (!target) {
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    setState('connecting')
    setError('')

    let result: DesktopOrgoSessionResult
    let RfbConstructor: typeof RFB

    try {
      const [session, noVnc] = await Promise.all([
        window.hermesDesktop.orgoDesktop.getSession(activeProfile),
        import('@novnc/novnc')
      ])

      result = session
      RfbConstructor = noVnc.default
    } catch (connectError) {
      if (generation === generationRef.current) {
        setState('error')
        setError(connectError instanceof Error ? connectError.message : copy.connectionFailed)
      }

      return
    }

    if (generation !== generationRef.current) {
      return
    }

    if (!result.ok) {
      setState('error')
      setError(result.error.message)

      return
    }

    rfbRef.current?.disconnect()
    target.replaceChildren()

    const rfb = new RfbConstructor(target, result.websocketUrl, {
      credentials: { password: result.password },
      shared: true
    })

    rfb.scaleViewport = true
    // Fit the whole framebuffer, letterboxed — clipping cropped the remote
    // screen's top and bottom to fill the rail's 16:10 frame, so the desktop
    // arrived decapitated. noVNC does the aspect math when clipping is off.
    rfb.clipViewport = false
    rfb.resizeSession = false
    rfb.qualityLevel = 7
    rfb.compressionLevel = 2
    rfb.viewOnly = viewOnly
    rfbRef.current = rfb
    setDesktopName(result.computerName)

    rfb.addEventListener('connect', () => {
      if (generation === generationRef.current) {
        setState('connected')

        measureScreenAspect()
      }
    })
    rfb.addEventListener('credentialsrequired', () => {
      rfb.sendCredentials({ password: result.password })
    })
    rfb.addEventListener('clipboard', event => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text

      if (text) {
        void window.hermesDesktop.writeClipboard(text)
      }
    })
    rfb.addEventListener('securityfailure', () => {
      if (generation === generationRef.current) {
        setState('error')
        setError(copy.securityFailure)
      }
    })
    rfb.addEventListener('disconnect', event => {
      if (generation !== generationRef.current || rfbRef.current !== rfb) {
        return
      }

      rfbRef.current = null
      const clean = (event as CustomEvent<{ clean?: boolean }>).detail?.clean
      setState(clean ? 'disconnected' : 'error')

      if (!clean) {
        setError(copy.disconnectedUnexpectedly)
      }
    })
  }, [
    activeProfile,
    copy.connectionFailed,
    copy.disconnectedUnexpectedly,
    copy.securityFailure,
    measureScreenAspect,
    viewOnly
  ])

  useEffect(() => {
    let cancelled = false
    const keepSettingsOpen = settingsProfileTargetRef.current === activeProfile

    disconnect()
    setConfig(null)
    setWorkspaceId('')
    setWorkspaces([])
    setComputers([])
    setInventoryLoaded(false)
    setDiscovering(false)
    setDesktopName('')
    setScreenSize(null)
    setError('')
    setView(keepSettingsOpen ? 'settings' : 'details')

    void window.hermesDesktop.orgoDesktop.getConfig(activeProfile).then(async next => {
      if (cancelled) {
        return
      }

      setConfig(next)
      setWorkspaceId(next.workspaceId || '')
      setComputerId(next.computerId)
      setView(keepSettingsOpen || !next.configured ? 'settings' : 'details')

      if (!next.apiKeySet) {
        return
      }

      try {
        const inventory = await window.hermesDesktop.orgoDesktop.listInventory({ profile: activeProfile })

        if (cancelled) {
          return
        }

        const selectedComputer = inventory.computers.find(computer => computer.id === next.computerId)
        setWorkspaces(inventory.workspaces)
        setComputers(inventory.computers)
        setInventoryLoaded(true)
        setWorkspaceId(next.workspaceId || selectedComputer?.workspaceId || '')
      } catch {
        // Discovery is recoverable from Settings and must not take down an
        // already-connected screen.
      }
    })

    return () => {
      cancelled = true
      disconnect()
    }
  }, [activeProfile, disconnect])

  useEffect(() => {
    if (visible && view === 'settings') {
      void refreshProfiles().catch(() => undefined)
    }
  }, [view, visible])

  useEffect(() => {
    if (visible && config?.configured && state === 'disconnected') {
      void connect()
    }
  }, [config?.configured, connect, state, visible])

  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.viewOnly = viewOnly
    }
  }, [viewOnly])

  useEffect(() => {
    if (!fullscreen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)

    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [fullscreen])

  const measurePreview = useCallback(() => {
    const bounds = desktopSlotRef.current?.getBoundingClientRect()

    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return
    }

    setPreviewBounds({
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width
    })
  }, [])

  useLayoutEffect(() => {
    if (!visible || view !== 'details' || fullscreen) {
      return
    }

    measurePreview()
    const target = desktopSlotRef.current
    const observer = target && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePreview) : null

    if (target) {
      observer?.observe(target)
    }

    window.addEventListener('resize', measurePreview)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measurePreview)
    }
  }, [fullscreen, measurePreview, view, visible])

  const saveAndConnect = async () => {
    setSaving(true)
    setError('')

    try {
      const next = await window.hermesDesktop.orgoDesktop.saveConfig({
        apiKey,
        computerId,
        workspaceId,
        profile: activeProfile
      })

      setConfig(next)
      setComputerId(next.computerId)
      setApiKey('')
      settingsProfileTargetRef.current = null
      setView('details')
      disconnect()
      await connect()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const discoverWorkspaces = async () => {
    const discoveryGeneration = discoveryGenerationRef.current + 1
    discoveryGenerationRef.current = discoveryGeneration
    setDiscovering(true)
    setError('')

    try {
      const inventory = await window.hermesDesktop.orgoDesktop.listInventory({
        apiKey: apiKey.trim() || undefined,
        profile: activeProfile
      })

      if (
        discoveryGeneration !== discoveryGenerationRef.current ||
        activeProfile !== normalizeProfileKey($activeGatewayProfile.get())
      ) {
        return
      }

      setWorkspaces(inventory.workspaces)
      setComputers(inventory.computers)
      setInventoryLoaded(true)

      if (computerId && !inventory.computers.some(computer => computer.id === computerId)) {
        setWorkspaceId('')
        setComputerId('')
      }
    } catch (discoveryError) {
      if (
        discoveryGeneration === discoveryGenerationRef.current &&
        activeProfile === normalizeProfileKey($activeGatewayProfile.get())
      ) {
        setError(discoveryError instanceof Error ? discoveryError.message : String(discoveryError))
      }
    } finally {
      if (
        discoveryGeneration === discoveryGenerationRef.current &&
        activeProfile === normalizeProfileKey($activeGatewayProfile.get())
      ) {
        setDiscovering(false)
      }
    }
  }

  const selectComputer = (computer: DesktopOrgoComputer) => {
    setComputerId(computer.id)
    setWorkspaceId(computer.workspaceId || '')
  }

  const clearProfileBinding = async () => {
    setSaving(true)
    setError('')

    try {
      const next = await window.hermesDesktop.orgoDesktop.clearConfig(activeProfile)
      setConfig(next)
      setWorkspaceId(next.workspaceId || '')
      setComputerId(next.computerId)
      setApiKey('')
      settingsProfileTargetRef.current = null
      setView(next.configured ? 'details' : 'settings')
      disconnect()

      if (next.configured) {
        await connect()
      }
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError))
    } finally {
      setSaving(false)
    }
  }

  const selectAgent = async (profile: string) => {
    const target = normalizeProfileKey(profile)

    if (target === activeProfile) {
      return
    }

    discoveryGenerationRef.current += 1
    settingsProfileTargetRef.current = target
    setSwitchingAgent(true)
    setError('')
    disconnect()

    try {
      await ensureGatewayProfile(target)
    } catch (switchError) {
      settingsProfileTargetRef.current = null
      setError(switchError instanceof Error ? switchError.message : String(switchError))
    } finally {
      setSwitchingAgent(false)
    }
  }

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()

      if (text) {
        rfbRef.current?.clipboardPasteFrom(text)
      }
    } catch {
      setError(copy.clipboardUnavailable)
    }
  }

  const enterFullscreen = () => setFullscreen(true)

  const leaveFullscreen = () => setFullscreen(false)

  const reconnect = () => {
    disconnect()
    void connect()
  }

  const focusComputer = () => {
    if (!viewOnly) {
      rfbRef.current?.focus({ preventScroll: true })
    }
  }

  // A machine can change resolution while we are watching it — xrandr on the
  // remote box, or a session that renegotiates. Sampling once at connect left
  // the frame stranded at the old shape, letterboxing a screen that had just
  // become taller. Observe the canvas instead.
  useEffect(() => {
    const host = screenRef.current

    if (!host) {
      return undefined
    }

    measureScreenAspect()

    const observer = new MutationObserver(measureScreenAspect)

    observer.observe(host, {
      attributeFilter: ['width', 'height'],
      attributes: true,
      childList: true,
      subtree: true
    })

    return () => observer.disconnect()
  }, [measureScreenAspect, state])

  const screenAspect = screenSize ? screenSize.width / screenSize.height : null
  // Guard the fraction: a tiny or unreported framebuffer must not turn the
  // panel trim into a crop that swallows the picture.
  const topCrop = screenSize ? Math.min(0.12, SCREEN_PANEL_PX / screenSize.height) : 0

  // The titlebar gear raises a request rather than reaching into this pane's
  // state; consume and clear it so a request made while the pane was closed
  // still lands on mount.
  const settingsRequested = useStore($orgoDesktopSettingsRequest)

  useEffect(() => {
    if (settingsRequested) {
      setView('settings')
      clearOrgoDesktopSettingsRequest()
    }
  }, [settingsRequested])

  const label = agentLabel(activeProfile, desktopName)

  const profileOptions = Array.from(
    new Set([activeProfile, ...profiles.map(profile => normalizeProfileKey(profile.name))])
  ).sort((left, right) => left.localeCompare(right))

  const desktopSurface = (
    <div
      className={`group fixed overflow-hidden bg-black ${
        fullscreen
          ? 'inset-0 z-[100] rounded-none'
          : 'z-[70] rounded-[8px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--ui-stroke-secondary)_55%,transparent),0_8px_24px_-12px_rgb(0_0_0/0.55)]'
      }`}
      // Fullscreen owns the window's keyboard. The global chat type-to-focus
      // and paste-to-focus handlers yield whenever this overlay marker exists,
      // leaving noVNC's focused canvas in control of printable keys.
      data-overlay-surface={fullscreen ? '' : undefined}
      ref={desktopFrameRef}
      style={
        fullscreen
          ? undefined
          : {
              height: previewBounds?.height ?? 0,
              left: previewBounds?.left ?? 0,
              top: previewBounds?.top ?? 0,
              visibility: visible && view === 'details' && previewBounds ? 'visible' : 'hidden',
              width: previewBounds?.width ?? 0
            }
      }
    >
      {/* noVNC nests its canvas inside its own screen div, so `[&>canvas]`
          rules never matched it — the old object-fit classes here were dead
          and every crop actually came from clipViewport. Crop by geometry
          instead: this element carries the remote screen's exact aspect and
          is anchored to the bottom, so it stands taller than its frame and
          the frame's rounded overflow clips the desktop's panel bar off the
          top. noVNC keeps ownership of scaling, so pointer mapping stays
          honest. */}
      <div
        aria-label={copy.screenAria}
        className={`overflow-hidden bg-black ${fullscreen ? 'h-full w-full' : 'absolute inset-x-0 bottom-0'}`}
        onPointerDownCapture={focusComputer}
        ref={screenRef}
        style={fullscreen || !screenAspect ? undefined : { aspectRatio: `${screenAspect}` }}
      />

      {!config && (
        <div className="absolute inset-0 grid place-items-center bg-(--ui-bg-primary)">
          <Loader className="size-5" label="Loading computer" type="lemniscate-bloom" />
        </div>
      )}

      {config && !config.configured && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--ui-bg-primary) px-4 text-center">
          <p className="text-[0.68rem] text-(--ui-text-tertiary)">Connect an Orgo computer to see its screen.</p>
          <Button onClick={() => setView('settings')} size="xs" variant="secondary">
            Connect computer
          </Button>
        </div>
      )}

      {config?.configured && state === 'connecting' && (
        <div className="absolute inset-0 grid place-items-center bg-(--ui-bg-primary)">
          <Loader className="size-5" label={copy.connecting} type="lemniscate-bloom" />
        </div>
      )}

      {config?.configured && state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--ui-bg-primary) px-4 text-center">
          <p className="line-clamp-2 text-[0.65rem] leading-4 text-(--ui-text-tertiary)">{error}</p>
          <Button onClick={reconnect} size="xs" variant="secondary">
            {copy.reconnect}
          </Button>
        </div>
      )}

      {state === 'connected' && !fullscreen ? (
        <button
          aria-label={copy.fullscreen}
          className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/35 group-hover:opacity-100 focus-visible:bg-black/35 focus-visible:opacity-100 focus-visible:outline-none"
          onClick={enterFullscreen}
          type="button"
        >
          <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-[0.68rem] font-medium shadow-sm backdrop-blur-sm">
            <Maximize className="size-3.5" />
            Open computer
          </span>
        </button>
      ) : null}

      {fullscreen ? (
        // Always light-on-dark: ghost buttons inherit theme text tokens, so in
        // light mode they would paint dark icons onto this black chrome.
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-black/70 p-1 backdrop-blur-sm">
          <Button
            aria-label={copy.pasteClipboard}
            className="text-white hover:bg-white/15 hover:text-white disabled:text-white/40"
            disabled={state !== 'connected' || viewOnly}
            onClick={() => void pasteClipboard()}
            size="icon-sm"
            variant="ghost"
          >
            <Clipboard />
          </Button>
          <Button
            aria-label="Exit fullscreen"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={leaveFullscreen}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-(--ui-editor-surface-background)">
      {createPortal(desktopSurface, document.body)}
      <div
        aria-hidden={view !== 'details'}
        className={`absolute inset-0 flex min-h-0 flex-col ${view === 'details' ? '' : 'pointer-events-none invisible'}`}
      >
        <section className="shrink-0 px-2.5 pt-2">
          <div
            className="w-full"
            ref={desktopSlotRef}
            style={{ aspectRatio: screenAspect ? `${screenAspect / (1 - topCrop)}` : '16 / 10' }}
          />

          <div className="relative flex h-8 items-center justify-center px-7 pt-0.5">
            <p className="truncate text-center text-[0.68rem] text-(--ui-text-tertiary)">{label}&apos;s screen</p>
          </div>
        </section>

        <AgentRoutines
          activeProfile={activeProfile}
          key={`${activeProfile}:${routinesRevision}`}
          onEdit={job => {
            setRoutine(job)
            setView('routine')
          }}
        />
      </div>

      {view === 'settings' ? (
        <div className="absolute inset-0 flex min-h-0 flex-col">
          <RailHeader
            onBack={() => {
              settingsProfileTargetRef.current = null
              setView('details')
            }}
            title="Computer"
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <form
              className="grid gap-5 pt-3"
              onSubmit={event => {
                event.preventDefault()
                void saveAndConnect()
              }}
            >
              <section className="grid gap-2.5">
                <h3 className="text-[0.65rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)">
                  Interaction
                </h3>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.7rem] text-(--ui-text-secondary)">View only</span>
                  <Switch aria-label={copy.viewOnly} checked={viewOnly} onCheckedChange={setViewOnly} size="xs" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    disabled={state !== 'connected' || viewOnly}
                    onClick={() => void pasteClipboard()}
                    size="xs"
                    type="button"
                    variant="secondary"
                  >
                    <Clipboard />
                    Paste
                  </Button>
                  <Button
                    disabled={!config?.configured || state === 'connecting'}
                    onClick={reconnect}
                    size="xs"
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw />
                    Reconnect
                  </Button>
                </div>
              </section>

              <section className="grid gap-3 border-t border-(--ui-stroke-tertiary) pt-4">
                <div className="space-y-1">
                  <h3 className="text-[0.65rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)">
                    Orgo connection
                  </h3>
                  <p className="text-[0.64rem] leading-4 text-(--ui-text-quaternary)">{copy.setupDescription}</p>
                </div>
                <label className="grid gap-1.5 text-[0.68rem] text-(--ui-text-secondary)">
                  {copy.agent}
                  <SearchableSelect
                    ariaLabel={copy.agent}
                    emptyMessage={copy.noAgents}
                    onChange={value => void selectAgent(value)}
                    options={profileOptions}
                    placeholder={copy.agentPlaceholder}
                    value={activeProfile}
                  />
                </label>
                <p className="text-[0.64rem] leading-4 text-(--ui-text-quaternary)">
                  {switchingAgent ? copy.switchingAgent : copy.agentIsolation}
                </p>
                <label className="grid gap-1.5 text-[0.68rem] text-(--ui-text-secondary)">
                  {copy.apiKey}
                  <Input
                    autoFocus={!config?.apiKeySet}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder={config?.apiKeySet ? copy.apiKeyStored : copy.apiKeyPlaceholder}
                    type="password"
                    value={apiKey}
                  />
                </label>
                <Button
                  disabled={discovering || (!config?.apiKeySet && !apiKey.trim())}
                  onClick={() => void discoverWorkspaces()}
                  size="xs"
                  type="button"
                  variant="secondary"
                >
                  {discovering ? copy.loadingInventory : inventoryLoaded ? copy.refreshInventory : copy.loadInventory}
                </Button>

                {inventoryLoaded ? (
                  <OrgoComputerPicker
                    computers={computers}
                    emptyMessage={copy.noComputers}
                    formatMatches={copy.inventoryMatches}
                    key={activeProfile}
                    listLabel={copy.inventoryListLabel}
                    onSelect={selectComputer}
                    scopeHint={copy.inventoryScopeHint}
                    searchPlaceholder={copy.searchInventory}
                    selectedComputerId={computerId}
                    summary={copy.inventorySummary(workspaces.length, computers.length)}
                    workspaces={workspaces}
                  />
                ) : null}

                {config?.inheritedFromDefault ? (
                  <p className="text-[0.64rem] leading-4 text-(--ui-text-quaternary)">
                    {copy.sharedComputer(activeProfile)}
                  </p>
                ) : activeProfile !== 'default' && config?.configured ? (
                  <Button
                    disabled={saving}
                    onClick={() => void clearProfileBinding()}
                    size="inline"
                    type="button"
                    variant="text"
                  >
                    {copy.useSharedComputer}
                  </Button>
                ) : null}
                {error ? <p className="text-[0.68rem] leading-4 text-destructive">{error}</p> : null}
                <Button
                  disabled={
                    saving || discovering || !workspaceId || !computerId || (!config?.apiKeySet && !apiKey.trim())
                  }
                  size="sm"
                  type="submit"
                >
                  {saving ? copy.saving : copy.saveAndConnect}
                </Button>
              </section>
            </form>
          </div>
        </div>
      ) : null}

      {view === 'routine' ? (
        <div className="absolute inset-0 flex min-h-0 flex-col">
          <RailHeader onBack={() => setView('details')} title="Routine" />
          <RoutineEditor
            job={routine}
            onClose={changed => {
              if (changed) {
                setRoutinesRevision(value => value + 1)
              }

              setView('details')
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
