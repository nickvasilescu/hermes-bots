import type { DesktopCommandSpec } from './desktop-slash-commands'

export const HANDOFF_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/handoff',
    description: 'Hand off this session to a messaging platform',
    surface: { kind: 'action', action: 'handoff' },
    argumentMode: 'options'
  }
]

export const DEBUG_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  { name: '/debug', description: 'Create a debug report', surface: { kind: 'exec' } }
]

export const ROLLBACK_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  { name: '/rollback', description: 'List or restore filesystem checkpoints', surface: { kind: 'exec' } }
]

export const STOP_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  { name: '/stop', description: 'Stop running background processes', surface: { kind: 'exec' } }
]

export const TOOLS_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/tools',
    description: 'List or toggle tools available to the agent',
    surface: { kind: 'exec' },
    argumentMode: 'options'
  }
]

export const JOURNEY_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/journey',
    description: 'Open the memory graph — skills + memories over time',
    aliases: ['/learning', '/memory-graph'],
    surface: { kind: 'action', action: 'journey' }
  }
]

export const YOLO_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/yolo',
    description: 'Toggle YOLO — auto-approve dangerous commands',
    surface: { kind: 'action', action: 'yolo' }
  }
]
