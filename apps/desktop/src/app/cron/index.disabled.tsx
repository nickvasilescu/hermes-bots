import type * as React from 'react'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface CronViewProps extends React.ComponentProps<'section'> {
  onClose: () => void
  onOpenSession: (sessionId: string) => void
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function CronView({
  onClose: _onClose,
  onOpenSession: _onOpenSession,
  setStatusbarItemGroup: _setStatusbarItemGroup,
  ...props
}: CronViewProps) {
  return (
    <section {...props} className="grid min-h-0 flex-1 place-items-center px-6 text-center">
      <div>
        <h2 className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">Automations</h2>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          Automations are managed on the Mini.
        </p>
      </div>
    </section>
  )
}
