import { useQuery } from '@tanstack/react-query'

import { getHermesConfigRecord } from '@/hermes'
import type { Translations } from '@/i18n'
import {
  Archive,
  Clock,
  Download,
  Globe,
  Info,
  KeyRound,
  Layers3,
  MessageCircle,
  Plug,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Starmap,
  Users,
  Wrench,
  Zap
} from '@/lib/icons'
import { allowsGenericHermesUpdates } from '@/lib/product'
import { prettyName } from '@/lib/text'
import { runGatewayRestart } from '@/store/system-actions'
import { requestActiveUpdate } from '@/store/updates'

import { openConnectors } from '../connectors/store'
import { CRON_ROUTE, MESSAGING_ROUTE, PROFILES_ROUTE, SKILLS_ROUTE, STARMAP_ROUTE } from '../routes'
import { FIELD_LABELS, SECTIONS } from '../settings/constants'
import { fieldCopyForSchemaKey } from '../settings/field-copy'

export const PALETTE_SECTIONS = SECTIONS

export const PALETTE_NON_CONFIG_SETTINGS = [
  {
    icon: Zap,
    keywords: ['accounts', 'sign in', 'oauth', 'login', 'subscription', 'models', 'anthropic', 'openai'],
    labelKey: 'providerAccounts',
    tab: 'providers&pview=accounts'
  },
  {
    icon: KeyRound,
    keywords: ['providers', 'api key', 'keys', 'secrets', 'tokens', 'egress', 'iron proxy', 'sandbox proxy'],
    labelKey: 'providerApiKeys',
    tab: 'providers&pview=keys'
  },
  { icon: Globe, keywords: ['connection', 'messaging'], labelKey: 'gateway', tab: 'gateway' },
  {
    icon: KeyRound,
    keywords: ['api', 'secrets', 'tokens', 'credentials', 'browser', 'search'],
    labelKey: 'keysTools',
    tab: 'keys&kview=tools'
  },
  {
    icon: Settings2,
    keywords: ['gateway', 'proxy', 'server', 'webhook', 'env', 'egress proxy', 'iron proxy'],
    labelKey: 'keysSettings',
    tab: 'keys&kview=settings'
  },
  { icon: Archive, keywords: ['history', 'archived'], labelKey: 'archivedChats', tab: 'sessions' },
  { icon: Info, keywords: ['version', 'about'], labelKey: 'about', tab: 'about' }
] as const

export const PALETTE_CAPABILITY_TABS = [
  { icon: Wrench, id: 'skills', keywords: ['skills', 'capabilities'], labelKey: 'tabSkills' },
  { icon: SlidersHorizontal, id: 'toolsets', keywords: ['tools', 'toolsets', 'capabilities'], labelKey: 'tabToolsets' },
  {
    icon: Layers3,
    id: 'mcp',
    keywords: ['mcp', 'servers', 'tools', 'capabilities', 'model context protocol'],
    labelKey: 'tabMcp'
  }
] as const

export function paletteConfigFieldLabel(translated: Record<string, string>, key: string): string {
  return (
    fieldCopyForSchemaKey(translated, key) ??
    fieldCopyForSchemaKey(FIELD_LABELS, key) ??
    prettyName(key.split('.').pop() ?? key)
  )
}

export function paletteConnectorItems(t: Translations) {
  return [
    {
      icon: Plug,
      id: 'set-connectors',
      keywords: ['plugins', 'connectors', 'composio', 'apps', 'integrations', 'extensions'],
      label: t.connectors.title,
      run: () => openConnectors()
    }
  ]
}

export function paletteMiniOwnedNavigationItems(t: Translations, go: (path: string) => () => void) {
  return [
    {
      action: 'nav.skills',
      icon: Wrench,
      id: 'nav-skills',
      keywords: ['skills', 'tools', 'toolsets', 'mcp', 'capabilities'],
      label: t.commandCenter.nav.skills.title,
      run: go(SKILLS_ROUTE)
    },
    {
      action: 'nav.messaging',
      icon: MessageCircle,
      id: 'nav-messaging',
      label: t.commandCenter.nav.messaging.title,
      run: go(MESSAGING_ROUTE)
    },
    {
      action: 'nav.cron',
      icon: Clock,
      id: 'nav-cron',
      keywords: ['schedule', 'jobs'],
      label: t.shell.statusbar.cron,
      run: go(CRON_ROUTE)
    },
    {
      action: 'nav.profiles',
      icon: Users,
      id: 'nav-profiles',
      label: t.profiles.title,
      run: go(PROFILES_ROUTE)
    },
    {
      icon: Starmap,
      id: 'nav-starmap',
      keywords: ['star map', 'memory', 'memories', 'skills', 'graph', 'learning', 'constellation'],
      label: t.starmap.title,
      run: go(STARMAP_ROUTE)
    }
  ]
}

export function paletteCommandCenterSystemItems(t: Translations, updateVersionLabel: string) {
  return [
    {
      icon: RefreshCw,
      id: 'cc-restart-gateway',
      keywords: ['gateway', 'restart', 'messaging', 'reconnect', 'system'],
      label: t.commandCenter.restartGateway,
      run: () => void runGatewayRestart()
    },
    ...(allowsGenericHermesUpdates()
      ? [
          {
            detail: updateVersionLabel,
            icon: Download,
            id: 'cc-update-hermes',
            keywords: ['update', 'upgrade', 'hermes', 'version', 'system', 'restart'],
            label: t.commandCenter.updateHermes,
            run: () => requestActiveUpdate()
          }
        ]
      : [])
  ]
}

export function paletteMcpServerNames(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return []
  }

  const raw = (config as Record<string, unknown>).mcp_servers

  return raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw as Record<string, unknown>).sort() : []
}

export function usePaletteConfigRecord() {
  return useQuery({ queryKey: ['command-palette', 'config'], queryFn: getHermesConfigRecord })
}

export function paletteMcpServerItems(names: string[], go: (path: string) => () => void) {
  return names.map(name => ({
    icon: Wrench,
    id: `mcp-${name}`,
    keywords: ['mcp', 'server', 'tool'],
    label: name,
    run: go(`${SKILLS_ROUTE}?tab=mcp&server=${encodeURIComponent(name)}`)
  }))
}
