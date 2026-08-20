import { useCallback } from 'react'

import type { HandoffSession } from './use-handoff-session.full'

export function useHandoffSession(_deps: unknown): HandoffSession {
  return useCallback(async () => ({ error: 'Messaging is managed on the Mini.', ok: false }), [])
}
