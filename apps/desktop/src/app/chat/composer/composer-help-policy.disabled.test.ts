import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveDesktopCommand } from '@/lib/desktop-slash-commands.disabled'

import { COMPOSER_HELP_COMMAND_KEYS, COMPOSER_HELP_HOTKEY_ROWS } from './composer-help-policy.disabled'

test('SSH composer help advertises only supported slash commands', () => {
  assert.equal(
    COMPOSER_HELP_COMMAND_KEYS.every(command => resolveDesktopCommand(command) !== null),
    true
  )
})

test('SSH composer help omits the unavailable keybind editor', () => {
  assert.equal(
    COMPOSER_HELP_HOTKEY_ROWS.some(row => String(row.id) === 'keybinds.openPanel'),
    false
  )
})
