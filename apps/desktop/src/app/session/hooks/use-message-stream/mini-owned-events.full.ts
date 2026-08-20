import { readActivePreview } from '@/app/chat/right-rail/preview-reader'
import { writeAgentTerminalChunk } from '@/app/right-sidebar/terminal/agent-terminal-stream'
import { readActiveTerminal } from '@/app/right-sidebar/terminal/buffer'
import { closeAgentTerminalByProc } from '@/app/right-sidebar/terminal/terminals'
import { translateNow } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { setMcpSetupRequest } from '@/store/mcp-setup'
import { dispatchNativeNotification } from '@/store/native-notifications'
import { revealDesktopPane } from '@/store/pane-focus'
import { setSecretRequest, setSudoRequest } from '@/store/prompts'

import type { ClientSessionState } from '../../../types'

interface MiniOwnedEventDeps {
  eventType: string
  isActiveEvent: boolean
  payload: Record<string, unknown> | null | undefined
  sessionId: null | string
  updateSessionState: (sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => unknown
  upsertToolCall: (
    sessionId: string,
    call: { args: Record<string, unknown>; name: string; tool_id: string },
    status: 'running'
  ) => unknown
}

export function handleMiniOwnedGatewayEvent({
  eventType,
  isActiveEvent,
  payload,
  sessionId,
  updateSessionState,
  upsertToolCall
}: MiniOwnedEventDeps): boolean {
  if (eventType === 'mcp.setup.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''
    const server = typeof payload?.server === 'string' ? payload.server : ''
    const rawAction = typeof payload?.action === 'string' ? payload.action : 'install'
    const action = rawAction === 'enable' || rawAction === 'authorize' ? rawAction : 'install'
    const reason = typeof payload?.reason === 'string' ? payload.reason : ''

    if (requestId && server) {
      setMcpSetupRequest({ action, reason, requestId, server, sessionId })

      if (sessionId) {
        upsertToolCall(
          sessionId,
          { args: { action, reason, server }, name: 'setup_mcp', tool_id: requestId },
          'running'
        )
        updateSessionState(sessionId, state => ({ ...state, needsInput: true }))
      }

      dispatchNativeNotification({
        body: reason || server,
        kind: 'input',
        sessionId,
        title: translateNow('notifications.native.inputTitle')
      })
    }

    return true
  }

  if (eventType === 'sudo.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

    if (requestId) {
      setSudoRequest({ requestId, sessionId })

      if (sessionId) {updateSessionState(sessionId, state => ({ ...state, needsInput: true }))}
      dispatchNativeNotification({
        body: translateNow('notifications.native.inputBody'),
        kind: 'input',
        sessionId,
        title: translateNow('notifications.native.inputTitle')
      })
    }

    return true
  }

  if (eventType === 'secret.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

    if (requestId) {
      const envVar = typeof payload?.env_var === 'string' ? payload.env_var : ''
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt : ''

      setSecretRequest({ envVar, prompt, requestId, sessionId })

      if (sessionId) {updateSessionState(sessionId, state => ({ ...state, needsInput: true }))}
      dispatchNativeNotification({
        body: prompt || envVar || translateNow('notifications.native.inputBody'),
        kind: 'input',
        sessionId,
        title: translateNow('notifications.native.inputTitle')
      })
    }

    return true
  }

  if (eventType === 'terminal.read.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

    if (requestId) {
      const start = typeof payload?.start === 'number' ? payload.start : undefined
      const count = typeof payload?.count === 'number' ? payload.count : undefined
      const result = readActiveTerminal({ count, start })

      void $gateway.get()?.request('terminal.read.respond', {
        request_id: requestId,
        text: result ? JSON.stringify(result) : ''
      })
    }

    return true
  }

  if (eventType === 'preview.read.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

    if (requestId) {
      const start = typeof payload?.start === 'number' ? payload.start : undefined
      const count = typeof payload?.count === 'number' ? payload.count : undefined

      void readActivePreview({ count, start }).then(result => {
        void $gateway.get()?.request('preview.read.respond', {
          request_id: requestId,
          text: result ? JSON.stringify(result) : ''
        })
      })
    }

    return true
  }

  if (eventType === 'window.read.request') {
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

    if (requestId) {
      const read = window.hermesDesktop?.readWindowBelow

      const answer = (result: unknown) =>
        $gateway.get()?.request('window.read.respond', {
          request_id: requestId,
          text: result ? JSON.stringify(result) : ''
        })

      void Promise.resolve(read ? read() : null).then(answer, () => answer(null))
    }

    return true
  }

  if (eventType === 'agent.terminal.output') {
    writeAgentTerminalChunk(
      typeof payload?.process_id === 'string' ? payload.process_id : '',
      typeof payload?.chunk === 'string' ? payload.chunk : ''
    )

    return true
  }

  if (eventType === 'terminal.close') {
    closeAgentTerminalByProc(typeof payload?.process_id === 'string' ? payload.process_id : '')

    return true
  }

  if (eventType === 'pane.reveal') {
    if (isActiveEvent) {revealDesktopPane(typeof payload?.pane === 'string' ? payload.pane : '')}

    return true
  }

  return false
}
