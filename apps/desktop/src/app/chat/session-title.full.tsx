import { TitleMenuTrigger } from '@/components/ui/title-menu-trigger'

import { SessionActionsMenu } from './sidebar/session-actions-menu'

interface SessionTitleProps {
  align: 'start'
  onDelete?: () => void
  onPin?: () => void
  pinned: boolean
  sessionId: string
  sideOffset: number
  title: string
}

export function SessionTitle({ title, ...actions }: SessionTitleProps) {
  return (
    <SessionActionsMenu title={title} {...actions}>
      <TitleMenuTrigger>{title}</TitleMenuTrigger>
    </SessionActionsMenu>
  )
}
