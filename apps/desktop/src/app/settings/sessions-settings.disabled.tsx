import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { deleteSession, listAllProfileSessions, setSessionArchived } from '@/hermes'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { pathLeaf } from '@/lib/display-path'
import { triggerHaptic } from '@/lib/haptics'
import { Archive, ArchiveOff, Loader2, Trash2 } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import { untombstoneSessions } from '@/store/projects'
import { setSessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { EmptyState, ListRow, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

const ARCHIVED_FETCH_LIMIT = 200

export function SessionsSettings() {
  const { t } = useI18n()
  const s = t.settings.sessions
  const [sessions, setLocalSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const result = await listAllProfileSessions(ARCHIVED_FETCH_LIMIT, 0, 'only')
      setLocalSessions(result.sessions)
    } catch (error) {
      notifyError(error, s.failedLoad)
    } finally {
      setLoading(false)
    }
  }, [s.failedLoad])

  useEffect(() => {
    void load()
  }, [load])

  const unarchive = useCallback(
    async (session: SessionInfo) => {
      setBusyId(session.id)

      try {
        await setSessionArchived(session.id, false, session.profile)
        setLocalSessions(current => current.filter(row => row.id !== session.id))
        untombstoneSessions([session.id, session._lineage_root_id])
        setSessions(current => [{ ...session, archived: false }, ...current.filter(row => row.id !== session.id)])
        triggerHaptic('selection')
        notify({ durationMs: 2_000, kind: 'success', message: s.restored })
      } catch (error) {
        notifyError(error, s.unarchiveFailed)
      } finally {
        setBusyId(null)
      }
    },
    [s]
  )

  const remove = useCallback(
    async (session: SessionInfo) => {
      if (!window.confirm(s.deleteConfirm(sessionTitle(session)))) {
        return
      }

      setBusyId(session.id)

      try {
        await deleteSession(session.id, session.profile)
        setLocalSessions(current => current.filter(row => row.id !== session.id))
        triggerHaptic('warning')
      } catch (error) {
        notifyError(error, s.deleteFailed)
      } finally {
        setBusyId(null)
      }
    },
    [s]
  )

  useDeepLinkHighlight({
    elementId: id => `archived-session-${id}`,
    param: 'session',
    ready: id => !loading && sessions.some(session => session.id === id)
  })

  if (loading) {
    return <SettingsSkeleton sections={[{ heading: true, rows: 4 }]} />
  }

  return (
    <SettingsContent>
      <SectionHeading
        icon={Archive}
        meta={sessions.length ? String(sessions.length) : undefined}
        title={s.archivedTitle}
      />
      <p className="mb-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        {s.archivedIntro}
      </p>

      {sessions.length === 0 ? (
        <EmptyState description={s.emptyArchivedDesc} title={s.emptyArchivedTitle} />
      ) : (
        <div className="grid gap-1">
          {sessions.map(session => {
            const label = pathLeaf(session.cwd)
            const busy = busyId === session.id

            return (
              <div className="scroll-mt-6 rounded-lg" id={`archived-session-${session.id}`} key={session.id}>
                <ListRow
                  action={
                    <div className="flex items-center gap-1.5">
                      <Button
                        disabled={busy}
                        onClick={() => void unarchive(session)}
                        size="sm"
                        type="button"
                        variant="textStrong"
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArchiveOff className="size-3.5" />}
                        <span>{s.unarchive}</span>
                      </Button>
                      <Tip label={s.deletePermanently}>
                        <Button
                          aria-label={s.deletePermanently}
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() => void remove(session)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Tip>
                    </div>
                  }
                  description={session.preview || undefined}
                  hint={label ? `${label} · ${s.messages(session.message_count)}` : s.messages(session.message_count)}
                  title={sessionTitle(session)}
                />
              </div>
            )
          })}
        </div>
      )}
    </SettingsContent>
  )
}
