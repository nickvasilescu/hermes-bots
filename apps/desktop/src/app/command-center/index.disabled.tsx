import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { $sessions } from '@/store/session'

export type CommandCenterSection = 'sessions'

interface CommandCenterViewProps {
  initialSection?: string
  onClose: () => void
  onDeleteSession: (sessionId: string) => Promise<void>
  onNavigateRoute?: (path: string) => void
  onOpenSession: (sessionId: string) => void
}

export function CommandCenterView({ onClose, onDeleteSession, onOpenSession }: CommandCenterViewProps) {
  const { t } = useI18n()
  const sessions = useStore($sessions)

  const sorted = useMemo(
    () =>
      [...sessions].sort(
        (left, right) => (right.last_active || right.started_at || 0) - (left.last_active || left.started_at || 0)
      ),
    [sessions]
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-(--ui-surface)" data-testid="command-center-sessions">
      <header className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
        <h1 className="text-sm font-semibold">{t.commandCenter.sections.sessions}</h1>
        <Button onClick={onClose} size="xs" type="button" variant="ghost">
          {t.commandCenter.close}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sorted.map(session => (
          <div className="flex items-center gap-2 rounded-md px-2 py-1" key={session.id}>
            <Button
              className="min-w-0 flex-1 justify-start truncate"
              onClick={() => onOpenSession(session.id)}
              type="button"
              variant="ghost"
            >
              {sessionTitle(session)}
            </Button>
            <Button
              aria-label={t.common.delete}
              onClick={() => void onDeleteSession(session.id)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {t.common.delete}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
