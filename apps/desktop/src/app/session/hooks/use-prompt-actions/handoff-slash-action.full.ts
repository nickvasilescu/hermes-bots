import type { MutableRefObject } from 'react'

import type { Translations } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { notify } from '@/store/notifications'

import type { HandoffSession } from './use-handoff-session.full'
import { slashStatusText } from './utils'

interface HandoffSlashActionContext {
  arg: string
  command: string
  recordInput: boolean
  sessionHint?: string
}

export function createHandoffSlashActionHandler<T extends HandoffSlashActionContext>({
  activeSessionIdRef,
  appendSessionTextMessage,
  copy,
  handoffSession
}: {
  activeSessionIdRef: MutableRefObject<string | null>
  appendSessionTextMessage: (
    sessionId: string,
    role: ChatMessage['role'],
    text: string,
    storedSessionId?: string | null
  ) => void
  copy: Translations['desktop']
  handoffSession: HandoffSession
}) {
  return async ({ arg, command, recordInput, sessionHint }: T): Promise<void> => {
    const platform = arg.trim()

    if (!platform) {
      notify({ kind: 'success', message: copy.handoff.pickPlatform })

      return
    }

    const sessionId = sessionHint || activeSessionIdRef.current

    if (!sessionId) {
      notify({ kind: 'error', title: copy.sessionUnavailable, message: copy.createSessionFailed })

      return
    }

    const result = await handoffSession(platform, { sessionId })

    if (!result.ok && result.error) {
      appendSessionTextMessage(sessionId, 'system', recordInput ? slashStatusText(command, result.error) : result.error)
    }
  }
}
