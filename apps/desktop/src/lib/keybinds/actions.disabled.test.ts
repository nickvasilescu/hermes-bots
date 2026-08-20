import assert from 'node:assert/strict'

import { test } from 'vitest'

import { KEYBIND_ACTION_IDS, KEYBIND_READONLY } from './actions.disabled'

test('SSH keybind inventory contains only installed runtime actions', () => {
  assert.deepEqual(KEYBIND_ACTION_IDS, ['session.new', 'nav.commandPalette'])
  assert.equal(
    KEYBIND_READONLY.some(action => action.id.startsWith('view.')),
    false
  )
})
