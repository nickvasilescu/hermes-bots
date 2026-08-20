import assert from 'node:assert/strict'

import { test } from 'vitest'

import { COMPLETION_REF_KINDS, COMPLETION_REF_META } from './completion-ref-kinds.disabled'

test('SSH completion starters expose only supported remote path references', () => {
  assert.deepEqual(COMPLETION_REF_KINDS, ['file', 'folder'])
  assert.deepEqual(Object.keys(COMPLETION_REF_META), ['file', 'folder'])
})
