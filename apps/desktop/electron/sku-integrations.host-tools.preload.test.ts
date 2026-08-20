import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createSkuHostToolsPreloadBridge } from './sku-integrations.host-tools.preload.disabled'

test('SSH-only preload has no arbitrary host-tool bridge', () => {
  const bridge = createSkuHostToolsPreloadBridge({} as any)
  assert.deepEqual(Object.keys(bridge), [])
})
