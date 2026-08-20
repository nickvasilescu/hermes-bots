import { type KeybindContribution, KEYBINDS_AREA } from '@desktop/keybind-actions'
import { PROFILE_TRANSFER_CONTRIBUTIONS } from '@desktop/profile-transfer-contributions'
import { discoverRuntimePlugins } from '@desktop/runtime-plugin-loader'

import { PALETTE_AREA, type PaletteContribution, paletteToggle } from '@/app/command-palette/contrib'
import { $layoutEditMode, toggleLayoutEditMode } from '@/components/pane-shell/edit-mode'
import { resetLayoutTree } from '@/components/pane-shell/tree/store'
import type { Contribution } from '@/contrib/types'
import { LayoutDashboard, PanelBottom } from '@/lib/icons'
import { isBotProduct } from '@/lib/product'
import { $statusbarVisible } from '@/store/statusbar-prefs'

export const CHROME_CONTRIBUTIONS: Contribution[] = [
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
  ...PROFILE_TRANSFER_CONTRIBUTIONS.map(data => ({ id: data.id, area: PALETTE_AREA, data }))
].filter(item => !isBotProduct() || item.id === 'keybinds.panel')
