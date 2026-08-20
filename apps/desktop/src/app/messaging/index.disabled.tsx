import type * as React from 'react'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface MessagingViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function MessagingView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: MessagingViewProps) {
  return (
    <section {...props} className="grid min-h-0 flex-1 place-items-center px-6 text-center">
      <div>
        <h2 className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">Messaging</h2>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          Messaging is managed on the Mini.
        </p>
      </div>
    </section>
  )
}
