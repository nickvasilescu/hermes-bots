import { describe, expect, it } from 'vitest'

import { buildFileAttachPayload, shouldUploadAttachmentBytes } from './file-attach-payload.disabled'

describe('SSH file attachment payload', () => {
  it('always uploads bytes and never forwards the client path to the Mini', () => {
    expect(shouldUploadAttachmentBytes()).toBe(true)
    expect(
      buildFileAttachPayload({
        dataUrl: 'data:text/plain;base64,c2FmZQ==',
        name: 'notes.txt',
        path: '/Users/carter/notes.txt',
        sessionId: 'session-1'
      })
    ).toEqual({
      data_url: 'data:text/plain;base64,c2FmZQ==',
      name: 'notes.txt',
      path: '',
      session_id: 'session-1'
    })
  })
})
