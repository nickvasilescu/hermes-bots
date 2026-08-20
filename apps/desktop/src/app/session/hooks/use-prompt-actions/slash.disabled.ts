import { useCallback } from 'react'

import { parseSlashCommand } from '@/lib/chat-runtime'
import { canonicalDesktopSlashCommand } from '@/lib/desktop-slash-commands'
import { notify } from '@/store/notifications'
import { setModelPickerOpen, setSessionPickerOpen } from '@/store/session'

interface SlashCommandDeps {
  activeSessionIdRef: { current: null | string }
  appendSessionTextMessage: (sessionId: string, role: 'system', text: string) => void
  branchCurrentSession: () => Promise<boolean>
  handleSkinCommand: (arg: string) => string
  startFreshSessionDraft: () => void
}

interface ExecuteOptions {
  recordInput?: boolean
  sessionId?: string
}

const HELP_TEXT = 'Available SSH commands: /new, /branch, /model, /resume, /skin, /help'

export function useSlashCommand({
  activeSessionIdRef,
  appendSessionTextMessage,
  branchCurrentSession,
  handleSkinCommand,
  startFreshSessionDraft
}: SlashCommandDeps) {
  return useCallback(
    async (rawCommand: string, options?: ExecuteOptions): Promise<void> => {
      const { arg, name } = parseSlashCommand(rawCommand.trim())
      const command = canonicalDesktopSlashCommand(name)

      switch (command) {
        case '/new':
          window.dispatchEvent(new CustomEvent('hermes:new-session-requested', { detail: { source: 'slash' } }))
          startFreshSessionDraft()

          return

        case '/branch':
          await branchCurrentSession()

          return

        case '/model':
          setModelPickerOpen(true)

          return

        case '/resume':
          setSessionPickerOpen(true)

          return
        case '/skin': {
          const message = handleSkinCommand(arg)
          const sessionId = options?.sessionId || activeSessionIdRef.current

          if (sessionId) {appendSessionTextMessage(sessionId, 'system', message)}
          else {notify({ kind: 'success', message })}

          return
        }

        case '/help': {
          const sessionId = options?.sessionId || activeSessionIdRef.current

          if (sessionId) {appendSessionTextMessage(sessionId, 'system', HELP_TEXT)}
          else {notify({ kind: 'info', message: HELP_TEXT })}

          return
        }

        default:
          notify({ kind: 'error', message: 'That command is not available in the SSH desktop.' })
      }
    },
    [activeSessionIdRef, appendSessionTextMessage, branchCurrentSession, handleSkinCommand, startFreshSessionDraft]
  )
}
