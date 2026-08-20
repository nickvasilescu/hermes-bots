export type KeybindCategory = 'composer' | 'profiles' | 'session' | 'navigation' | 'view'

export interface KeybindActionMeta {
  id: string
  category: KeybindCategory
  defaults: readonly string[]
  label?: string
}

export interface KeybindContribution {
  id: string
  category?: KeybindCategory
  defaults?: readonly string[]
  label: string
  run: () => void
}

export interface KeybindReadonly {
  id: string
  category: KeybindCategory
  keys: readonly string[]
}

export type KeybindBindings = Record<string, string[]>

export const KEYBIND_PANEL_ACTION = 'ssh.unavailable'
export const KEYBIND_CATEGORIES: readonly KeybindCategory[] = ['composer', 'session', 'navigation']
export const PROFILE_SLOT_COUNT = 0
export const SESSION_SLOT_COUNT = 0
export const KEYBINDS_AREA = 'keybinds'

export const KEYBIND_ACTIONS: readonly KeybindActionMeta[] = [
  { id: 'session.new', category: 'session', defaults: ['mod+n'] },
  { id: 'nav.commandPalette', category: 'navigation', defaults: ['mod+k', 'mod+p'] }
]

export const KEYBIND_ACTION_IDS: readonly string[] = KEYBIND_ACTIONS.map(action => action.id)

export const KEYBIND_READONLY: readonly KeybindReadonly[] = [
  { id: 'composer.send', category: 'composer', keys: ['enter'] },
  { id: 'composer.newline', category: 'composer', keys: ['shift+enter'] },
  { id: 'composer.steer', category: 'composer', keys: ['enter'] },
  { id: 'composer.queue', category: 'composer', keys: ['mod+enter'] },
  { id: 'composer.sendQueued', category: 'composer', keys: ['mod+shift+k'] },
  { id: 'composer.mention', category: 'composer', keys: ['@'] },
  { id: 'composer.slash', category: 'composer', keys: ['/'] },
  { id: 'composer.help', category: 'composer', keys: ['?'] },
  { id: 'composer.history', category: 'composer', keys: ['up', 'down'] },
  { id: 'composer.cancel', category: 'composer', keys: ['escape'] }
]

const ACTION_BY_ID = new Map(KEYBIND_ACTIONS.map(action => [action.id, action]))

export function contributedKeybinds(): KeybindContribution[] {
  return []
}

export function contributedKeybindHandler(_id: string): (() => void) | undefined {
  return undefined
}

export function allKeybindActions(): KeybindActionMeta[] {
  return [...KEYBIND_ACTIONS]
}

export function keybindAction(id: string): KeybindActionMeta | undefined {
  return ACTION_BY_ID.get(id)
}

export function defaultBindings(): KeybindBindings {
  return Object.fromEntries(KEYBIND_ACTIONS.map(action => [action.id, [...action.defaults]]))
}
