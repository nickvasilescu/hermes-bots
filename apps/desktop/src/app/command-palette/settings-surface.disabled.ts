import type { Translations } from '@/i18n'
import { Archive, Info, MessageCircle, Palette } from '@/lib/icons'
import { prettyName } from '@/lib/text'

import { fieldCopyForSchemaKey } from '../settings/field-copy'

export const PALETTE_SECTIONS = [
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  { id: 'appearance', label: 'Appearance', icon: Palette, keys: [] }
] as const

export const PALETTE_NON_CONFIG_SETTINGS = [
  { icon: Archive, keywords: ['history', 'archived'], labelKey: 'archivedChats', tab: 'sessions' },
  { icon: Info, keywords: ['version', 'about'], labelKey: 'about', tab: 'about' }
] as const

export const PALETTE_CAPABILITY_TABS = [] as const

const FALLBACK_FIELD_LABELS: Record<string, string> = {
  'agent.image_input_mode': 'Image Attachments',
  'display.personality': 'Personality',
  'display.show_reasoning': 'Reasoning Blocks',
  timezone: 'Timezone'
}

export function paletteConfigFieldLabel(translated: Record<string, string>, key: string): string {
  return fieldCopyForSchemaKey(translated, key) ?? FALLBACK_FIELD_LABELS[key] ?? prettyName(key.split('.').pop() ?? key)
}

export function paletteConnectorItems(_t: Translations): readonly [] {
  return []
}

export function paletteMiniOwnedNavigationItems(_t: Translations, _go: (path: string) => () => void): readonly [] {
  return []
}

export function paletteCommandCenterSystemItems(_t: Translations, _updateVersionLabel: string): readonly [] {
  return []
}

export function paletteMcpServerNames(_config: unknown): readonly [] {
  return []
}

export function usePaletteConfigRecord(): { data: undefined } {
  return { data: undefined }
}

export function paletteMcpServerItems(_names: readonly string[], _go: (path: string) => () => void): readonly [] {
  return []
}
