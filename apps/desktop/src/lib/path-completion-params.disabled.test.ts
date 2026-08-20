import { describe, expect, it } from 'vitest'

import { buildPathCompletionParams } from './path-completion-params.disabled'

describe('SSH path completion parameters', () => {
  it('allows only relative file and folder completion without forwarding cwd', () => {
    expect(buildPathCompletionParams({ cwd: '/mini/secret', sessionId: 's1', word: '@file:src/app' })).toEqual({
      session_id: 's1',
      word: '@file:src/app'
    })
    expect(buildPathCompletionParams({ cwd: '/mini/secret', sessionId: 's1', word: '@folder:' })).toEqual({
      session_id: 's1',
      word: '@folder:'
    })
  })

  it.each(['@tool:', '@git:', '@file:/etc', '@folder:../secret', '@file:a//b', '@file:%2e%2e/secret'])(
    'rejects unsafe or plugin completion %s',
    word => {
      expect(buildPathCompletionParams({ cwd: '/mini/secret', sessionId: 's1', word })).toBeNull()
    }
  )
})
