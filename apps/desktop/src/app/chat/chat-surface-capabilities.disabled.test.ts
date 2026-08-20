import { describe, expect, it } from 'vitest'

import { CHAT_SURFACE_CAPABILITIES } from './chat-surface-capabilities.disabled'

describe('SSH chat surface capabilities', () => {
  it('does not advertise local context, file drop, or voice controls', () => {
    expect(CHAT_SURFACE_CAPABILITIES).toEqual({ fileDrop: false, tools: false, voice: false })
  })
})
