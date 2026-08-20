import type { LayoutNode } from '@/components/pane-shell/tree/model'

// The SSH SKU keeps a real core session/sidebar pane, while local terminal,
// filesystem, review, statusbar, and plugin-owned Bot panes stay unreachable.
export const CORE_SESSIONS_PANE_ALLOWED = true
export const LOCAL_CORE_PANES_ALLOWED = false
export const SINGLE_LAYOUT_ONLY = true
export const STATUSBAR_CHROME_ALLOWED = false
export const BOT_ROSTER_PANE_ID = 'sessions'

export function selectProductTree(trees: { bot: LayoutNode; ssh: LayoutNode; standard: LayoutNode }): LayoutNode {
  return trees.ssh
}
