import { describe, expect, it } from 'vitest'

import { UNSCOPED_STREAM_EVENT_TYPES } from './gateway-event-types.disabled'

describe('SSH gateway event catalog', () => {
  it('keeps chat/session events without Mini-owned setup or credential prompts', () => {
    expect(UNSCOPED_STREAM_EVENT_TYPES).toContain('message.start')
    expect(UNSCOPED_STREAM_EVENT_TYPES).toContain('approval.request')
    expect(UNSCOPED_STREAM_EVENT_TYPES).not.toContain('mcp.setup.request')
    expect(UNSCOPED_STREAM_EVENT_TYPES).not.toContain('sudo.request')
    expect(UNSCOPED_STREAM_EVENT_TYPES).not.toContain('secret.request')
  })
})
