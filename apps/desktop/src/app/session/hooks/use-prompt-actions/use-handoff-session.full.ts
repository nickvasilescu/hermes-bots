import { type MutableRefObject, useCallback } from 'react'

import type { Translations } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { normalize } from '@/lib/text'
import { notify } from '@/store/notifications'

import type { HandoffFailResponse, HandoffRequestResponse, HandoffStateResponse } from '../../../types'

import { delay, type GatewayRequest, inlineErrorMessage } from './utils'

export interface HandoffResult {
  ok: boolean
  error?: string
}

export type HandoffSession = (
  platform: string,
  options?: { onProgress?: (state: string) => void; sessionId?: string }
) => Promise<HandoffResult>

export function useHandoffSession({
  activeSessionIdRef,
  appendSessionTextMessage,
  copy,
  requestGateway
}: {
  activeSessionIdRef: MutableRefObject<string | null>
  appendSessionTextMessage: (
    sessionId: string,
    role: ChatMessage['role'],
    text: string,
    storedSessionId?: string | null
  ) => void
  copy: Translations['desktop']
  requestGateway: GatewayRequest
}): HandoffSession {
  return useCallback(
    async (platform, options) => {
      const sessionId = options?.sessionId || activeSessionIdRef.current

      if (!sessionId) {
        return { error: copy.sessionUnavailable, ok: false }
      }

      const target = normalize(platform)

      if (!target) {
        return { error: copy.handoff.failed(''), ok: false }
      }

      try {
        options?.onProgress?.('pending')
        await requestGateway<HandoffRequestResponse>('handoff.request', {
          platform: target,
          session_id: sessionId
        })
      } catch (error) {
        return { error: inlineErrorMessage(error, copy.handoff.failed(target)), ok: false }
      }

      const markCompleted = (): HandoffResult => {
        appendSessionTextMessage(sessionId, 'system', copy.handoff.systemNote(target))
        notify({ kind: 'success', message: copy.handoff.success(target) })

        return { ok: true }
      }

      const deadline = Date.now() + 60_000
      let lastState = 'pending'

      while (Date.now() < deadline) {
        await delay(800)

        let record: HandoffStateResponse

        try {
          record = await requestGateway<HandoffStateResponse>('handoff.state', { session_id: sessionId })
        } catch {
          continue
        }

        const state = record.state || 'pending'

        if (state !== lastState) {
          options?.onProgress?.(state)
          lastState = state
        }

        if (state === 'completed') {
          return markCompleted()
        }

        if (state === 'failed') {
          return { error: record.error || copy.handoff.failed(target), ok: false }
        }
      }

      const cleanup = await requestGateway<HandoffFailResponse>('handoff.fail', {
        error: copy.handoff.timedOut,
        session_id: sessionId
      }).catch(() => null)

      if (cleanup?.state === 'completed') {
        return markCompleted()
      }

      return { error: copy.handoff.timedOut, ok: false }
    },
    [activeSessionIdRef, appendSessionTextMessage, copy, requestGateway]
  )
}
