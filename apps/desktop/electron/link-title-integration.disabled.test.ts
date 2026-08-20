import assert from 'node:assert/strict'

import { test } from 'vitest'

import { registerLinkTitleIntegration } from './link-title-integration.disabled'

test('disabled link-title integration exposes no registration capability', () => {
  assert.equal(registerLinkTitleIntegration, undefined)
})
