import type { MutableRefObject } from 'react'

import type { Translations } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { setSessionYolo } from '@/lib/yolo-session'
import { notify } from '@/store/notifications'
import { $yoloActive, setYoloActive } from '@/store/session'

import type { GatewayRequest } from './utils'

interface YoloSlashActionDeps {
  activeSessionIdRef: MutableRefObject<string | null>
  appendSessionTextMessage: (sessionId: string, role: ChatMessage['role'], text: string) => void
  copy: Translations['desktop']
  requestGateway: GatewayRequest
}

export function createYoloSlashActionHandler({
  activeSessionIdRef,
  appendSessionTextMessage,
  copy,
  requestGateway
}: YoloSlashActionDeps): (ctx: { sessionHint?: string }) => Promise<void> {
  return async ({ sessionHint }) => {
    const sid = sessionHint || activeSessionIdRef.current
    const next = !$yoloActive.get()

    if (!sid) {
      setYoloActive(next)
      notify({ kind: 'success', message: next ? copy.yoloArmed : copy.yoloOff })

      return
    }

    try {
      const active = await setSessionYolo(requestGateway, sid, next)
      appendSessionTextMessage(sid, 'system', copy.yoloSystem(active))
    } catch {
      notify({ kind: 'error', title: copy.yoloTitle, message: copy.yoloToggleFailed })
    }
  }
}
