export const COMPOSER_HELP_COMMAND_KEYS = ['/help', '/clear', '/resume', '/details', '/copy', '/quit'] as const

export const COMPOSER_HELP_HOTKEY_ROWS = [
  { id: 'composer.mention', combos: ['@'] },
  { id: 'composer.slash', combos: ['/'] },
  { id: 'composer.help', combos: ['?'] },
  { id: 'composer.sendNewline', combos: ['enter', 'shift+enter'] },
  { id: 'composer.sendQueued', combos: ['mod+shift+k'] },
  { id: 'keybinds.openPanel', combos: ['mod+/'] },
  { id: 'composer.cancel', combos: ['escape'] },
  { id: 'composer.history', combos: ['up', 'down'] }
] as const
