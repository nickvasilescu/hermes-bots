import assert from 'node:assert/strict'

import { test } from 'vitest'

import { partitionDroppedFiles } from './chat-file-drop.disabled'

test('SSH chat file-drop seam rejects all candidate files', () => {
  assert.deepEqual(partitionDroppedFiles([{ path: '/run/korgo-ssh/identity' }]), { inAppRefs: [], osDrops: [] })
})
