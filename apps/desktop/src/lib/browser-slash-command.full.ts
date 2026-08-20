import type { DesktopCommandSpec } from './desktop-slash-commands'

export const BROWSER_SLASH_COMMAND_SPECS: readonly DesktopCommandSpec[] = [
  {
    name: '/browser',
    description: 'Manage browser CDP connection [connect|disconnect|status] (local gateway only)',
    surface: { kind: 'action', action: 'browser' },
    argumentMode: 'options'
  }
]
