import '@/app/bot-product/shell.css'

import { useStore } from '@nanostores/react'
import { atom, computed } from 'nanostores'
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react'

import { CHAT_HEADER_AREA } from '@/app/chat/contrib'
import { SessionDraftTitle } from '@/app/chat/session-draft-title'
import { SessionStatusDot } from '@/app/chat/session-status-dot'
import { PALETTE_AREA, type PaletteContribution, paletteToggle } from '@/app/command-palette/contrib'
import { ConnectorsModal } from '@/app/connectors/modal'
import { type StatusbarItem } from '@/app/shell/statusbar-controls'
import { IdleMount } from '@/components/idle-mount'
import { $layoutEditMode, toggleLayoutEditMode } from '@/components/pane-shell/edit-mode'
import { allPaneIds, group, groupLeafIds, split } from '@/components/pane-shell/tree/model'
import { LayoutTreeRoot } from '@/components/pane-shell/tree/renderer'
import type { DoubleTapContext } from '@/components/pane-shell/tree/renderer/drag-session'
import {
  $layoutTree,
  bindPaneVisibility,
  bindToolPaneCollapse,
  bindTreeSideVisibility,
  declareDefaultTree,
  dismissTreePane,
  isPaneVisible,
  markCollapsePane,
  mirrorLayoutTree,
  paneRootSide,
  registerLayoutResetHandler,
  registerPaneCloser,
  registerPaneOpener,
  removeTreePane,
  resetLayoutTree,
  revealTreePane,
  togglePaneVisible,
  watchContributedPanes
} from '@/components/pane-shell/tree/store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { discoverBundledPlugins } from '@/contrib/plugins'
import { Slot } from '@/contrib/react/slot'
import { useContributions } from '@/contrib/react/use-contributions'
import { registry } from '@/contrib/registry'
import { discoverRuntimePlugins } from '@/contrib/runtime-loader'
import { NEW_SESSION_TITLE, sessionTitle as storedSessionTitle } from '@/lib/chat-runtime'
import { Download, FileText, LayoutDashboard, Monitor, PanelBottom, Terminal, Upload, Zap } from '@/lib/icons'
import { type KeybindContribution, KEYBINDS_AREA } from '@/lib/keybinds/actions'
import { isBotProduct } from '@/lib/product'
import { allowsDesktopCapability } from '@/lib/product-capabilities'
import { setYoloEnabled } from '@/lib/yolo-session'
import { pruneComposerPopoutZones } from '@/store/composer-popout'
import {
  $fileBrowserOpen,
  $panesFlipped,
  $sidebarOpen,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_MAX_WIDTH,
  FILE_BROWSER_MIN_WIDTH,
  setFileBrowserOpen,
  setSidebarOpen,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '@/store/layout'
import { runExportProfileFlow, runImportProfileFlow } from '@/store/profile-share'
import { $reviewOpen, closeReview, openReview, REVIEW_PANE_ID } from '@/store/review'
import { $currentCwd, $selectedStoredSessionId, $sessions, $yoloActive, sessionMatchesStoredId } from '@/store/session'
import { watchSessionPins } from '@/store/session-pin-sync'
import { $statusbarVisible } from '@/store/statusbar-prefs'
import { isHudWindow } from '@/store/windows'

import type { SessionDragPayload } from '../chat/composer/inline-refs'
import { watchPreviewTiles } from '../chat/preview-tile'
import { watchRouteTiles } from '../chat/route-tile'
import { startSessionDrag } from '../chat/session-drag'
import {
  SessionTileCloseConfirm,
  stackSessionTilesIntoMain,
  watchSessionTiles,
  WorkspaceTabMenu
} from '../chat/session-tile'
import { HudShell } from '../hud/hud-shell'
import { OrgoDesktopPane } from '../right-sidebar/desktop'
import { ResizableComputerRail } from '../right-sidebar/desktop/rail'
import { $orgoDesktopOpen, $terminalTakeover, setOrgoDesktopOpen, setTerminalTakeover } from '../right-sidebar/store'
import { $workspaceIsPage } from '../routes'
import { ShellContextMenu } from '../shell/shell-context-menu'

import { FilesPane, LogsPane, ReviewPaneContent } from './panes'
import { ContribWiring, WiredPane } from './wiring'

/**
 * Stripped-down app root (bb/contrib-areas) on the layout TREE model, mounting
 * the REAL app surfaces. The title bar and status bar sit OUTSIDE the grid
 * (fixed chrome) but are fully composable: title bar renders `titleBar.left/
 * right` slots; the status bar consumes `statusBar.left/right` DATA
 * contributions (payload = StatusbarItem). Core registers its items through
 * the same calls a plugin would use.
 */

// ---------------------------------------------------------------------------
// Pane contributions. `data.placement` = semantic role for grid presets;
// `data.minWidth/maxWidth/minHeight/maxHeight` = the SAME clamps the app's
// `Pane` props declare — the layout tree sizes zones by weight (percentage)
// but a zone never shrinks/grows past its active pane's clamp.
// Headers are contextual (tree-side): a pane alone in a zone shows no
// header/tab by default; stacked panes show chips. Double-click a zone
// toggles its header either way.
// ---------------------------------------------------------------------------

// ONE render identity for the workspace pane — syncWorkspaceTitle re-registers
// the contribution (new title) and a fresh closure would remount the chat.
const renderWorkspacePane = () => <WiredPane part="chatRoutes" />

// Boot-hidden panes mount behind display:none (instant-toggle contract) — defer
// them to idle so they're off the first-paint path, warm before reveal.
const idle = (node: ReactElement) => <IdleMount>{node}</IdleMount>
const ORGO_DESKTOP_ALLOWED = allowsDesktopCapability('allowOrgo')
const CONNECTORS_ALLOWED = allowsDesktopCapability('allowComposio')
// The main tab carries the same session context menu as tile tabs (targets
// the loaded primary session; no menu on a fresh draft).
const wrapWorkspaceTab = (tab: ReactElement) => <WorkspaceTabMenu>{tab}</WorkspaceTabMenu>

if (isBotProduct()) {
  $statusbarVisible.set(false)
}

/** The `@session` payload for the workspace tab — the loaded primary session,
 *  or null on a fresh draft / full-page view (nothing to link). */
const workspaceDragPayload = (): SessionDragPayload | null => {
  const selected = $selectedStoredSessionId.get()

  if (!selected || $workspaceIsPage.get()) {
    return null
  }

  const stored = $sessions.get().find(s => sessionMatchesStoredId(s, selected))

  return { id: selected, profile: stored?.profile ?? '', title: stored ? storedSessionTitle(stored) : '' }
}

// The main tab drags like a session tile — drop it on a composer to link the
// chat, on a zone/edge to stack/split. Defers (`false`) to the generic pane
// move when there's no loaded session to carry.
const workspaceTabDrag = (event: ReactPointerEvent<HTMLElement>, onTap: () => void, double?: DoubleTapContext) => {
  const payload = workspaceDragPayload()

  if (!payload) {
    return false
  }

  startSessionDrag(payload, event, { double, onTap })

  return true
}

registry.registerMany(
  [
    !isBotProduct()
      ? {
          id: 'sessions',
          area: 'panes' as const,
          title: 'sessions',
          data: {
            placement: 'left',
            collapsible: true,
            dock: { pane: 'workspace', pos: 'left' },
            revealAliases: ['chat-sidebar'],
            width: `${SIDEBAR_DEFAULT_WIDTH}px`,
            minWidth: `${SIDEBAR_DEFAULT_WIDTH}px`,
            maxWidth: `${SIDEBAR_MAX_WIDTH}px`
          },
          render: () => <WiredPane part="sidebar" />
        }
      : null,
    {
      id: 'workspace',
      area: 'panes',
      title: NEW_SESSION_TITLE,
      data: {
        placement: 'main',
        minWidth: '22vw',
        tabDrag: workspaceTabDrag,
        tabWrap: wrapWorkspaceTab,
        uncloseable: true
      },
      render: renderWorkspacePane
    },
    !isBotProduct()
      ? {
          id: 'terminal',
          area: 'panes' as const,
          title: 'terminal',
          data: { placement: 'bottom', height: '20vh', maxHeight: '80vh', revealOnPreset: true },
          render: () => <WiredPane part="terminal" />
        }
      : null,
    !isBotProduct()
      ? {
          id: 'files',
          area: 'panes' as const,
          title: 'files',
          data: {
            placement: 'right',
            collapsible: true,
            dock: { pane: 'workspace', pos: 'right' },
            revealAliases: ['file-browser'],
            width: FILE_BROWSER_DEFAULT_WIDTH,
            minWidth: FILE_BROWSER_MIN_WIDTH,
            maxWidth: FILE_BROWSER_MAX_WIDTH
          },
          render: () => idle(<FilesPane />)
        }
      : null,
    !isBotProduct()
      ? {
          id: 'review',
          area: 'panes' as const,
          title: 'review',
          data: {
            placement: 'right',
            collapsible: true,
            revealAliases: [REVIEW_PANE_ID],
            width: FILE_BROWSER_DEFAULT_WIDTH,
            minWidth: FILE_BROWSER_MIN_WIDTH,
            maxWidth: FILE_BROWSER_MAX_WIDTH
          },
          render: () => idle(<ReviewPaneContent />)
        }
      : null
  ].filter(Boolean) as Parameters<typeof registry.registerMany>[0]
)

// ---------------------------------------------------------------------------
// Chrome contributions. The title bar and status bar are fixed chrome outside
// the grid, composable through these areas. Everything real lives in the real
// components (TitlebarControls / useStatusbarItems). Sample PLUGIN
// contributions don't live here — they're their own files under `src/plugins/`,
// auto-discovered by discoverBundledPlugins() below.
// ---------------------------------------------------------------------------

registry.registerMany(
  [
    {
      id: 'layout.editMode',
      area: KEYBINDS_AREA,
      data: {
        id: 'layout.editMode',
        label: 'Toggle layout edit mode',
        defaults: ['mod+shift+\\'],
        run: toggleLayoutEditMode
      } satisfies KeybindContribution
    },
    paletteToggle({
      id: 'layout.editMode',
      label: 'Toggle layout edit mode',
      action: 'layout.editMode',
      icon: LayoutDashboard,
      keywords: ['layout', 'zones', 'panes', 'edit', 'rearrange'],
      get: () => $layoutEditMode.get(),
      set: enabled => $layoutEditMode.set(enabled)
    }),
    {
      id: 'plugins.reload',
      area: PALETTE_AREA,
      data: {
        id: 'plugins.reload',
        label: 'Reload desktop plugins',
        keywords: ['plugins', 'reload', 'refresh', 'desktop'],
        run: () => void discoverRuntimePlugins()
      } satisfies PaletteContribution
    },
    {
      id: 'layout.reset',
      area: PALETTE_AREA,
      data: {
        id: 'layout.reset',
        label: 'Reset layout',
        icon: LayoutDashboard,
        keywords: ['layout', 'reset', 'default', 'panes'],
        run: resetLayoutTree
      } satisfies PaletteContribution
    },
    paletteToggle({
      id: 'view.toggleStatusbar',
      label: 'Toggle status bar',
      action: 'view.toggleStatusbar',
      icon: PanelBottom,
      keywords: ['status bar', 'statusbar', 'bottom bar', 'hide', 'show', 'chrome'],
      get: () => $statusbarVisible.get(),
      set: enabled => $statusbarVisible.set(enabled)
    }),
    {
      id: 'keybinds.panel',
      area: PALETTE_AREA,
      data: {
        id: 'keybinds.panel',
        label: 'Keyboard shortcuts',
        keywords: ['keybinds', 'shortcuts', 'hotkeys', 'keyboard'],
        run: () => window.dispatchEvent(new CustomEvent('hermes:open-keybinds'))
      } satisfies PaletteContribution
    },
    {
      id: 'profile.export',
      area: PALETTE_AREA,
      data: {
        id: 'profile.export',
        label: 'Export profile…',
        icon: Upload,
        keywords: ['profile', 'export', 'share', 'bundle', 'theme', 'settings', 'backup'],
        run: () => void runExportProfileFlow()
      } satisfies PaletteContribution
    },
    {
      id: 'profile.import',
      area: PALETTE_AREA,
      data: {
        id: 'profile.import',
        label: 'Import profile…',
        icon: Download,
        keywords: ['profile', 'import', 'share', 'bundle', 'archive', 'restore'],
        run: () => void runImportProfileFlow()
      } satisfies PaletteContribution
    }
  ].filter(item => !isBotProduct() || item.id === 'keybinds.panel')
)

// ---------------------------------------------------------------------------
// Layout presets — CHAT (main) always dominates.
// ---------------------------------------------------------------------------

// The REAL default: sessions left, chat main, and the right sidebars in column
// order main | … | review | file-browser (files outermost). Each is its OWN
// zone. Review collapses to nothing while its pane is hidden (⌘G off).
//
// Preview tiles are DYNAMIC panes (like session tiles), so no preset names one:
// they're registered by watchPreviewTiles as tabs open, and dockPaneBeside lands
// each one directly beside the file tree wherever that currently lives — so a
// file double-click still slides a preview open as its own pane next to the
// tree, never as a tab stacked into the files sidebar.
const DEFAULT_TREE = split(
  'row',
  [
    group(['sessions'], { id: 'grp-sessions' }),
    group(['workspace'], { id: 'grp-main' }),
    split(
      'column',
      [
        split(
          'row',
          [group(['review'], { id: 'grp-review' }), group(['files'], { id: 'grp-files' })],
          [1, 1.2],
          'spl-rail'
        ),
        group(['terminal'], { id: 'grp-terminal' })
      ],
      [1.6, 1],
      'spl-right'
    )
  ],
  [1, 3.4, 1.25],
  'spl-root'
)

// Bot products open in the messenger layout users already know from Bot Mode:
// a persistent roster at left, the active Bot Chat in the center, and the
// fixed computer/routines rail mounted by ContribController at right.
const BOT_TREE = split(
  'row',
  [
    group(['hermes-bots:pane-v2'], { id: 'grp-bots' }),
    group(['workspace'], { id: 'grp-main' })
  ],
  [1, 3.4],
  'spl-root'
)

const PRODUCT_TREE = isBotProduct() ? BOT_TREE : DEFAULT_TREE

const FOCUS_TREE = split('row', [group(['sessions']), group(['workspace', 'files', 'review', 'terminal'])], [1, 4.6])

const TERMINAL_TREE = split(
  'column',
  [
    split('row', [group(['sessions']), group(['workspace']), group(['files', 'review'])], [1, 3.2, 1.2]),
    group(['terminal'])
  ],
  [3, 1]
)

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['sessions', 'files']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['review'])], [1.4, 1])
  ],
  [3, 1]
)

registry.registerMany(
  isBotProduct()
    ? [{ id: 'default', area: 'layouts', title: 'Default', order: 0, data: PRODUCT_TREE }]
    : [
        { id: 'default', area: 'layouts', title: 'Default', order: 0, data: DEFAULT_TREE },
        { id: 'focus', area: 'layouts', title: 'Focus', order: 10, data: FOCUS_TREE },
        { id: 'terminal-deck', area: 'layouts', title: 'Terminal deck', order: 20, data: TERMINAL_TREE },
        { id: 'quad', area: 'layouts', title: 'Quad', order: 30, data: QUAD_TREE }
      ]
)

declareDefaultTree(PRODUCT_TREE)

// Bundled plugins load AFTER core, so a same-id contribution from a plugin
// deliberately overrides the core default (last writer wins). Third-party
// runtime plugins will flow through the same discovery seam.
discoverBundledPlugins()

// Plugin panes join the tree by their `placement` hint the moment they
// register — incl. runtime plugins arriving seconds after boot.
watchContributedPanes()

// Session + route (page) tiles: persisted splits register panes docked beside
// main.
watchSessionTiles()
watchRouteTiles()
watchPreviewTiles()

// Composer pop-out state is keyed by layout zone, so drop entries for zones the
// user has since closed or merged away — otherwise a long-lived install keeps a
// row for every split it has ever had.
$layoutTree.subscribe(tree => {
  if (tree) {
    pruneComposerPopoutZones(groupLeafIds(tree))
  }
})

// Mirror sidebar pins into the backend keep-flag so the auto-archive sweep
// never hides a pinned chat (and pre-existing pins migrate transparently).
watchSessionPins()

// The main tab reads as its SESSION (the loaded title, "New session" on a
// fresh draft) — a stack of main + tiles is then just a row of session names.
// register() replaces same-id in place; the render fn is the shared constant
// above, so the pane content never remounts.
const syncWorkspaceTitle = () => {
  const selected = $selectedStoredSessionId.get()
  const stored = selected ? $sessions.get().find(s => sessionMatchesStoredId(s, selected)) : null

  registry.register({
    id: 'workspace',
    area: 'panes',
    // The placeholder, not the draft's live name — `tabTitle` below renders
    // that. Keeping it here would re-register the pane on every keystroke.
    title: stored ? storedSessionTitle(stored) : NEW_SESSION_TITLE,
    data: {
      // The tab's status dot — the SAME primitive the sidebar row and session
      // tiles render, so the main tab never disagrees with its sidebar row. A
      // fresh draft has no session to key by, which IS its status: the dot
      // resolves to `draft` and marks the tab rather than leaving a hole.
      tabLead: () => <SessionStatusDot session={stored} storedSessionId={selected} />,
      // A draft's name lives in its composer, not in any session row, so the
      // label subscribes to it directly — typing renames the tab without
      // re-registering the pane.
      tabTitle: stored ? undefined : () => <SessionDraftTitle scope={selected} />,
      // Pages aren't tab-able: the main zone's bar stands down while one shows.
      headerVeto: $workspaceIsPage.get(),
      placement: 'main',
      minWidth: '22vw',
      tabDrag: workspaceTabDrag,
      tabWrap: wrapWorkspaceTab,
      uncloseable: true
    },
    render: renderWorkspacePane
  })
}

$selectedStoredSessionId.listen(syncWorkspaceTitle)
$sessions.listen(syncWorkspaceTitle)
$workspaceIsPage.listen(syncWorkspaceTitle)

// Layout reset collapses every session tile into main as a tab (after the
// workspace) instead of re-scattering them — pre-placed before adoption.
registerLayoutResetHandler(stackSessionTilesIntoMain)

// ---------------------------------------------------------------------------
// Titlebar chrome toggles -> tree. The TitlebarControls buttons keep their
// store semantics ($sidebarOpen / $fileBrowserOpen / $panesFlipped); the tree
// reacts — a hidden pane's zone collapses (content stays mounted), the flip
// toggle mirrors the root row.
// ---------------------------------------------------------------------------

// HIDE-STYLE PANES (files, review, preview): the binding lives in the tree
// store — bindPaneVisibility — alongside bindToolPaneCollapse, so both are
// testable against the real function instead of a copy.

// TOOL PANELS (terminal, logs): the binding lives in the tree store —
// bindToolPaneCollapse — so the boot rule it encodes is testable against the
// real function instead of a copy. See its docblock for the semantics.

// SIDES have one source of truth: the TREE. The legacy $panesFlipped flag is
// DERIVED from where the sessions zone actually sits (TitlebarControls maps
// its left/right buttons through it), so dragging sessions across — or
// applying a mirrored preset — remaps the buttons automatically. The flip
// action (⌘\ / titlebar) mirrors the tree only when they disagree.
const sessionsOnRight = () => {
  const tree = $layoutTree.get()

  if (!tree) {
    return null
  }

  const order = allPaneIds(tree)
  const sessions = order.indexOf('sessions')
  const main = order.indexOf('workspace')

  return sessions >= 0 && main >= 0 ? sessions > main : null
}

$layoutTree.subscribe(() => {
  const flipped = sessionsOnRight()

  if (flipped !== null && flipped !== $panesFlipped.get()) {
    $panesFlipped.set(flipped)
  }
})

$panesFlipped.listen(flipped => {
  const current = sessionsOnRight()

  if (current !== null && current !== flipped) {
    mirrorLayoutTree()
  }
})

// POSITIONAL side toggles (titlebar buttons, ⌘B / ⌘J): $sidebarOpen ≙ the
// LEFT side of the main zone, $fileBrowserOpen ≙ the RIGHT — everything on
// that side hides together, whatever panes have been rearranged there.
bindTreeSideVisibility('left', $sidebarOpen, setSidebarOpen)
bindTreeSideVisibility('right', $fileBrowserOpen, setFileBrowserOpen)

// Workspace-scoped surfaces: the file tree and git diff only mean something
// inside a project. A detached chat (no cwd) hides them — their zones
// collapse and the chat absorbs the width; picking a project brings them
// back. The terminal is NOT workspace-gated: unlike the old shell (where it
// rode the rail's row and vanished with it), its zone stands on its own.
const $hasWorkspace = computed($currentCwd, cwd => Boolean(cwd.trim()))

// The tree pane's own presence tracks ⌘J directly, not just the column's
// collapse — otherwise a pane revealed into that shared column would drag the
// tree along with it.
//
// Both get a CLOSER and an OPENER. The closer keeps ⌘J/⌘G truthful when the
// pane is closed from the tab menu; the opener is its mirror, so bringing the
// pane back through the tree (the toggle's reveal path, the rail, a preset)
// writes the store too. Without the opener the boolean went stale the moment
// anything but the toggle showed the pane — the divergence this whole change
// is about.
bindPaneVisibility(
  'files',
  computed([$hasWorkspace, $fileBrowserOpen], (workspace, open) => workspace && open),
  () => setFileBrowserOpen(false),
  () => setFileBrowserOpen(true)
)
// ⌘G — the review sidebar appears/disappears (and comes to the front).
bindPaneVisibility(
  'review',
  computed([$reviewOpen, $hasWorkspace], (open, workspace) => open && workspace),
  closeReview,
  openReview
)
// ⌃` / statusbar toggle — the terminal COLLAPSES to a rail (tab stays), not
// hides; PTYs stay alive while collapsed (see PersistentTerminal).
bindToolPaneCollapse(
  'terminal',
  $terminalTakeover,
  () => setTerminalTakeover(false),
  () => setTerminalTakeover(true)
)
// ⌘K door onto the same pane the keybind and statusbar pill flip — was a
// one-way "open" row under Go to, so it never showed on/off and couldn't hide.
// Reads the TREE like every other pane toggle: `$terminalTakeover` stays true
// behind a stacked sibling tab or a minimized zone, which would light the row
// "on" for a terminal that isn't on screen.
registry.register(
  paletteToggle({
    id: 'view.showTerminal',
    label: 'Toggle terminal',
    action: 'view.showTerminal',
    icon: Terminal,
    keywords: ['terminal', 'shell', 'console', 'pty'],
    get: () => isPaneVisible('terminal'),
    set: () => togglePaneVisible('terminal')
  })
)

// Logs are ⌘K-ONLY chrome: the pane contribution EXISTS only while $logsOpen
// is on. Off (the default) keeps logs out of the registry and the tree
// entirely — no secondary tab riding the terminal strip, no preset or
// adoption path that resurrects it. Session-only on purpose (not persisted):
// a fresh boot never re-opens logs automatically. The palette toggle is the
// single door in; tab ✕ / ⌘W / the toggle itself remove it again.
const $logsOpen = atom(false)

let unregisterLogsPane: (() => void) | null = null

const syncLogsPane = (open: boolean) => {
  if (open) {
    unregisterLogsPane ??= registry.register({
      id: 'logs',
      area: 'panes',
      title: 'logs',
      // Same tool-panel sizing rule as the terminal above — no minHeight, so
      // the sash floors it at COLLAPSED_ZONE_PX and folds the zone to its rail
      // rather than leaving a sliver. dock: its OWN zone beside the terminal —
      // never a tab in the terminal's strip.
      data: {
        placement: 'bottom',
        dock: { pane: 'terminal', pos: 'right' },
        height: '20vh',
        maxHeight: '80vh'
      },
      render: () => idle(<LogsPane />)
    })
    // Summoning logs is explicit intent — front it (un-dismisses if a ✕ close
    // left a dismissal record behind).
    revealTreePane('logs')
  } else {
    unregisterLogsPane?.()
    unregisterLogsPane = null

    // No dismissal record — the next toggle-on must re-adopt cleanly. Also
    // sweeps 'logs' out of persisted trees from before it was summon-only.
    // Guarded: removePane rebuilds the tree even for an absent pane, and a
    // no-op boot sweep would commit (and persist) a fresh identical tree.
    const tree = $layoutTree.get()

    if (tree && allPaneIds(tree).includes('logs')) {
      removeTreePane('logs')
    }
  }
}

// Tool-panel tab semantics (✕ / ⌘W route through the store) so the palette
// toggle stays truthful either way.
markCollapsePane('logs')
registerPaneCloser('logs', () => $logsOpen.set(false))
registerPaneOpener('logs', () => $logsOpen.set(true))
syncLogsPane($logsOpen.get())
$logsOpen.listen(syncLogsPane)

registry.register(
  paletteToggle({
    id: 'logs.toggle',
    label: 'Toggle logs',
    icon: FileText,
    keywords: ['logs', 'agent log', 'tail', 'debug'],
    // On-screen, not the store's boolean. Summon-only keeps the two in step
    // while logs sits in its own zone, but the user can still drag it into the
    // terminal's strip or minimize its zone — and then `$logsOpen` reads true
    // with nothing visible, so the row would show "on" and its press would
    // spend itself re-asserting a value it already held.
    get: () => isPaneVisible('logs'),
    set: () => togglePaneVisible('logs')
  })
)

// Computer details are fixed app chrome, not a tile. ContribController mounts
// the rail outside the layout tree so terminals, previews, and persisted user
// layouts can never add a tab strip or steal part of its height.
if (ORGO_DESKTOP_ALLOWED) {
  registry.register(
    paletteToggle({
      id: 'computer.toggle',
      label: 'Toggle computer',
      icon: Monitor,
      keywords: ['computer', 'desktop', 'orgo', 'vnc', 'remote'],
      get: () => $orgoDesktopOpen.get(),
      set: setOrgoDesktopOpen
    })
  )
}

// YOLO (dangerous-command approval bypass) is a status-bar zap and a /yolo
// command; ⌘K is the third door onto the SAME store function, so a user who
// lives in the palette never has to hunt for the pill.
registry.register(
  paletteToggle({
    id: 'session.yolo',
    label: 'Toggle yolo',
    icon: Zap,
    keywords: ['yolo', 'approvals', 'auto-approve', 'bypass', 'dangerous', 'commands'],
    get: () => $yoloActive.get(),
    set: enabled => void setYoloEnabled(enabled).catch(() => undefined)
  })
)

// Sessions/files Close = collapse their SIDE (⌘B/⌘J truthful, titlebar button
// flips back) — but only while the pane actually lives in that root side
// column. Dragged next to main, a side collapse can't hide it (the collapse
// skips main-bearing children), so Close falls back to dismissal there —
// otherwise ⌘W/Close silently no-op.
registerPaneCloser('sessions', () =>
  paneRootSide('sessions') === 'left' ? setSidebarOpen(false) : dismissTreePane('sessions')
)
registerPaneCloser('files', () =>
  paneRootSide('files') === 'right' ? setFileBrowserOpen(false) : dismissTreePane('files')
)

// ---------------------------------------------------------------------------

interface TitlebarSlotProps {
  area: string
  className: string
  style?: CSSProperties
}

function TitlebarSlot({ area, className, style }: TitlebarSlotProps) {
  const items = useContributions(area)

  if (items.length === 0) {
    return null
  }

  return (
    <div className={className} style={style}>
      <Slot area={area} />
    </div>
  )
}

export function ContribController() {
  const orgoDesktopOpen = useStore($orgoDesktopOpen)
  const sidebarOpen = useStore($sidebarOpen)
  const statusbarVisible = useStore($statusbarVisible)

  // HUD mode is the SAME app with its frame removed: the wiring (gateway,
  // sessions, streams, submit) mounts identically, and only the shell around
  // the chat surface differs. Branching here rather than at the window entry
  // is what keeps the HUD's composer the real composer.
  if (isHudWindow()) {
    return (
      <ContribWiring>
        <HudShell />
      </ContribWiring>
    )
  }

  return (
    <SidebarProvider
      className={isBotProduct() ? 'h-screen min-h-0 flex-col bg-background bot-product-shell' : 'h-screen min-h-0 flex-col bg-background'}
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={{ '--sidebar-width': '100%' } as CSSProperties}
    >
      <ContribWiring>
        <ShellContextMenu>
          <div
            className="relative flex h-screen min-h-0 w-screen flex-col bg-(--ui-bg-chrome) text-(--ui-text-primary)"
            style={{ '--titlebar-height': '0px' } as CSSProperties}
          >
            {/* Window-level seam overlays cannot be covered by pane or titlebar
                surfaces, so both side-panel dividers visibly reach the very
                top and bottom of the app. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-50 w-px bg-(--ui-stroke-secondary)"
              style={{ left: 'var(--workspace-left, 0px)' }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-50 w-px bg-(--ui-stroke-secondary)"
              style={{ right: 'var(--workspace-right, 0px)' }}
            />
            {/* Title bar: fixed chrome outside the grid, composable via slots.
              Layout contract (no contribution can break it):
                - a full-bar DRAG BASE underneath (pointer-events-none, like
                  AppShell's drag strips) — everywhere without content drags
                  the window;
                - each slot region is width-fit, no-drag, pointer-events-auto,
                  so every contribution is clickable by construction;
                - LEFT/RIGHT slots align to the MAIN PANE's geometry via the
                  tree-published --workspace-left/right vars (pure CSS, no rect
                  threading), clamped to clear the REAL TitlebarControls
                  clusters (fixed, z-70); center is truly window-centered. */}
            <div
              className="relative flex h-[38px] shrink-0 items-center bg-(--ui-chat-surface-background) text-xs"
              data-slot="contrib-titlebar"
            >
              {/* The global titlebar sits outside the pane tree. Repaint the
                  left rail's portion with its own surface, then continue both
                  tree seams through this band so neither divider stops short
                  at the top of the window. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 bg-(--ui-sidebar-surface-background)"
                style={{ width: 'var(--workspace-left, 0px)' }}
              />
              {/* Drag strips, AppShell-style: cut to AVOID the fixed control
                clusters instead of overlapping them — Electron's no-drag
                carve-out of fixed/transformed elements is unreliable, so a
                full-bar drag base kills their clicks. In-flow slot content
                still carves via its own no-drag wrapper (the same pattern as
                the app's session-title button). */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 w-(--titlebar-controls-left,14px) [-webkit-app-region:drag]"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-[calc(var(--titlebar-controls-left,14px)+(var(--titlebar-control-size,24px)*2)+0.75rem)] right-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,5.5rem)+0.75rem)] [-webkit-app-region:drag]"
              />
              <TitlebarSlot
                area="titleBar.left"
                className="pointer-events-auto absolute z-10 flex w-max items-center gap-2 [-webkit-app-region:no-drag]"
                style={{
                  left: 'max(calc(var(--workspace-left, 0px) + 0.5rem), calc(var(--titlebar-controls-left, 14px) + 2 * var(--titlebar-control-size, 24px) + 1rem))'
                }}
              />
              <TitlebarSlot
                area="titleBar.center"
                className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex w-max -translate-x-1/2 -translate-y-1/2 items-center gap-2 [-webkit-app-region:no-drag]"
              />
              <TitlebarSlot
                area="titleBar.right"
                className="pointer-events-auto absolute z-10 flex w-max items-center gap-2 [-webkit-app-region:no-drag]"
                style={{
                  right:
                    'max(calc(var(--workspace-right, 0px) + 0.5rem), calc(var(--titlebar-tools-right, 0.75rem) + 5 * var(--titlebar-control-size, 24px) + 0.5rem))'
                }}
              />
              <TitlebarSlot
                area={CHAT_HEADER_AREA}
                className="pointer-events-none absolute inset-y-0 z-20 [-webkit-app-region:no-drag]"
                style={{
                  left: 'var(--workspace-left, 0px)',
                  right: 'var(--workspace-right, 0px)'
                }}
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1">
              <LayoutTreeRoot />
              {ORGO_DESKTOP_ALLOWED && orgoDesktopOpen ? (
                <ResizableComputerRail>
                  <OrgoDesktopPane />
                </ResizableComputerRail>
              ) : null}
            </div>

            {/* "Close running tab?" — the busy/input-blocked tile close gate. */}
            <SessionTileCloseConfirm />
            {CONNECTORS_ALLOWED ? <ConnectorsModal /> : null}

            {/* The REAL statusbar (model pill, command center, agents, …) with
              statusBar.left/right contributions merged in. Unmounted — not
              just hidden — while toggled off, so its 15s status poll and the
              per-turn readouts stop with it. */}
            {statusbarVisible && !isBotProduct() && <WiredPane part="statusbar" />}
          </div>
        </ShellContextMenu>
      </ContribWiring>
    </SidebarProvider>
  )
}

// Referenced type kept for plugin authors' reference (payload shape of
// statusBar.* contributions).
export type { StatusbarItem }
