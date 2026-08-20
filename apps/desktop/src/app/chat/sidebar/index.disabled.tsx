import { ProfileRail } from '@desktop/profile-rail'
import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'
import { $sessions, $sessionsLoading } from '@/store/session'
import type { SplitDir } from '@/store/session-states'

import type { AppView } from '../../routes'
import type { SidebarNavItem } from '../../types'

export interface ChatSidebarProps extends React.ComponentProps<'aside'> {
  currentView: AppView
  onArchiveSession: (sessionId: string) => void
  onBranchSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onLoadMoreMessaging?: (platform: string) => Promise<void> | void
  onLoadMoreSessions: () => Promise<void> | void
  onManageCronJob: (jobId: string) => void
  onNavigate: (item: SidebarNavItem) => void
  onNewSessionInWorkspace: (path: null | string) => void
  onNewSessionSplit: (dir: SplitDir) => void
  onResumeSession: (sessionId: string) => void
  onTriggerCronJob: (jobId: string) => void
}

const NEW_SESSION_NAV_ITEM: SidebarNavItem = {
  action: 'new-session',
  icon: () => null,
  id: 'new-session',
  keybindActionId: 'session.new',
  label: 'New session'
}

export function ChatSidebar({
  className,
  onLoadMoreSessions,
  onNavigate,
  onResumeSession,
  ...props
}: ChatSidebarProps) {
  const { t } = useI18n()
  const sessions = useStore($sessions)
  const loading = useStore($sessionsLoading)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const startNewSession = () => onNavigate(NEW_SESSION_NAV_ITEM)
    window.addEventListener('hermes:new-session-shortcut', startNewSession)

    return () => window.removeEventListener('hermes:new-session-shortcut', startNewSession)
  }, [onNavigate])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (!needle) {
      return sessions
    }

    return sessions.filter(session => {
      const title = sessionTitle(session).toLowerCase()
      const preview = session.preview?.toLowerCase() ?? ''

      return title.includes(needle) || preview.includes(needle)
    })
  }, [query, sessions])

  return (
    <aside
      aria-label={t.sidebar.sessions}
      className={cn('flex h-full min-h-0 w-full flex-col border-r bg-sidebar', className)}
      {...props}
    >
      <div className="flex items-center gap-2 border-b p-2">
        <Button className="shrink-0" onClick={() => onNavigate(NEW_SESSION_NAV_ITEM)} size="sm" type="button">
          New session
        </Button>
        <SearchField onChange={setQuery} placeholder={t.sidebar.searchPlaceholder} value={query} />
      </div>

      <ProfileRail />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.map(session => (
          <Button
            className="mb-1 h-auto w-full justify-start overflow-hidden px-2 py-2 text-left"
            key={session.id}
            onClick={() => onResumeSession(session.id)}
            type="button"
            variant="ghost"
          >
            <span className="truncate">{sessionTitle(session)}</span>
          </Button>
        ))}

        {!loading && visible.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{t.sidebar.noSessions}</p>
        ) : null}
      </div>

      <div className="border-t p-2">
        <Button disabled={loading} onClick={() => void onLoadMoreSessions()} size="sm" type="button" variant="ghost">
          {loading ? t.sidebar.loading : t.sidebar.loadMore}
        </Button>
      </div>
    </aside>
  )
}
