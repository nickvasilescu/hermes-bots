import type { LayoutNode } from '@/components/pane-shell/tree/model'
import { isBotProduct } from '@/lib/product'

export const CORE_SESSIONS_PANE_ALLOWED = !isBotProduct()
export const LOCAL_CORE_PANES_ALLOWED = !isBotProduct()
export const SINGLE_LAYOUT_ONLY = isBotProduct()
export const STATUSBAR_CHROME_ALLOWED = !isBotProduct()
export const BOT_ROSTER_PANE_ID = 'hermes-bots:pane-v2'

export function selectProductTree(trees: { bot: LayoutNode; ssh: LayoutNode; standard: LayoutNode }): LayoutNode {
  return isBotProduct() ? trees.bot : trees.standard
}
