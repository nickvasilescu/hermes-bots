export interface CommandsCatalogSection {
  name: string
  pairs: [string, string][]
}

export interface CommandsCatalogLike {
  categories?: CommandsCatalogSection[]
  pairs?: [string, string][]
  skill_count?: number
  skills?: SkillCatalogMap
  warning?: string
}

export interface SkillCatalogEntry {
  origin?: 'bundled' | 'hub' | 'local'
  usage?: number
}

export type SkillCatalogMap = Record<string, SkillCatalogEntry>

export interface DesktopSlashCompletion {
  display: string
  meta: string
  text: string
}

export interface DesktopThemeCommandOption {
  description: string
  label: string
  name: string
}

export type DesktopActionId = 'branch' | 'help' | 'new' | 'skin'
export type DesktopPickerId = 'model' | 'session'
export type DesktopUnavailableReason = 'advanced' | 'messaging' | 'settings' | 'terminal'

export type DesktopCommandSurface =
  | { action: DesktopActionId; kind: 'action' }
  | { kind: 'picker'; picker: DesktopPickerId }
  | { kind: 'unavailable'; reason: DesktopUnavailableReason }

export interface SlashCommandBuildCtx {
  arg: string
  command: string
  name: string
  sessionId?: string
}

export type DesktopSlashArgumentMode = 'mixed' | 'options' | 'text'

export interface DesktopCommandSpec {
  aliases?: readonly string[]
  argumentMode?: DesktopSlashArgumentMode
  description: string
  hidden?: boolean
  name: string
  surface: DesktopCommandSurface
}

const SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/new',
    aliases: ['/reset'],
    description: 'Start a new desktop chat',
    surface: { kind: 'action', action: 'new' }
  },
  {
    name: '/branch',
    aliases: ['/fork'],
    description: 'Branch the latest message into a new chat',
    surface: { kind: 'action', action: 'branch' }
  },
  {
    name: '/skin',
    description: 'Switch desktop theme',
    surface: { kind: 'action', action: 'skin' },
    argumentMode: 'options'
  },
  {
    name: '/help',
    aliases: ['/commands'],
    description: 'Show SSH desktop commands',
    surface: { kind: 'action', action: 'help' }
  },
  { name: '/model', description: 'Switch the model for this session', surface: { kind: 'picker', picker: 'model' } },
  { name: '/resume', description: 'Resume a saved session', surface: { kind: 'picker', picker: 'session' } }
]

const normalize = (command: string): string => {
  const value = command.trim().toLowerCase()

  return value.startsWith('/') ? value : `/${value}`
}

export function resolveDesktopCommand(command: string): DesktopCommandSpec | null {
  const normalized = normalize(command)

  return SPECS.find(spec => spec.name === normalized || spec.aliases?.includes(normalized)) ?? null
}

export function canonicalDesktopSlashCommand(command: string): string {
  return resolveDesktopCommand(command)?.name ?? normalize(command)
}

export function isDesktopSlashExtensionCommand(_command: string): boolean {
  return false
}

export function isDesktopSlashCommand(command: string): boolean {
  return resolveDesktopCommand(command) !== null
}

export function isDesktopSlashSuggestion(command: string): boolean {
  return isDesktopSlashCommand(command)
}

export function isPickerCommand(command: string, picker?: DesktopPickerId): boolean {
  const surface = resolveDesktopCommand(command)?.surface

  return surface?.kind === 'picker' && (!picker || surface.picker === picker)
}

export function isModelPickerCommand(command: string): boolean {
  return isPickerCommand(command, 'model')
}

export function desktopSlashUnavailableMessage(_command: string): string | null {
  return null
}

export function desktopSlashDescription(command: string, fallback = ''): string {
  return resolveDesktopCommand(command)?.description ?? fallback
}

export function desktopSlashCommandArgumentMode(command: string): DesktopSlashArgumentMode | null {
  return resolveDesktopCommand(command)?.argumentMode ?? null
}

export function desktopSkinSlashCompletions(
  themes: DesktopThemeCommandOption[],
  activeSkin: string,
  query: string
): DesktopSlashCompletion[] {
  const needle = query.trim().toLowerCase()

  return themes
    .filter(theme => !needle || theme.label.toLowerCase().includes(needle) || theme.name.toLowerCase().includes(needle))
    .map(theme => ({
      display: theme.label,
      meta: theme.name === activeSkin ? 'Current theme' : theme.description,
      text: `/skin ${theme.name}`
    }))
}

export function rankSkillCommands<T extends { text: string }>(items: T[], _skills?: SkillCatalogMap): T[] {
  return items.filter(item => isDesktopSlashSuggestion(item.text))
}

export function filterDesktopCommandsCatalog(catalog: CommandsCatalogLike): CommandsCatalogLike {
  const filterPairs = (pairs: [string, string][] = []): [string, string][] =>
    pairs.filter(([command]) => isDesktopSlashSuggestion(command))

  return {
    ...catalog,
    categories: catalog.categories
      ?.map(category => ({ ...category, pairs: filterPairs(category.pairs) }))
      .filter(category => category.pairs.length > 0),
    pairs: filterPairs(catalog.pairs),
    skill_count: 0,
    skills: {}
  }
}
