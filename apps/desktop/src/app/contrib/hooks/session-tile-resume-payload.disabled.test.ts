import { describe, expect, it } from 'vitest'

import { buildSessionTileResumePayload } from './session-tile-resume-payload.disabled'

describe('SSH session tile resume payload', () => {
  it('identifies the desktop source without dropping the owning profile', () => {
    expect(buildSessionTileResumePayload({ profile: 'work', sessionId: 'stored-1' })).toEqual({
      cols: 96,
      omit_messages: true,
      profile: 'work',
      session_id: 'stored-1',
      source: 'desktop'
    })
  })
})
