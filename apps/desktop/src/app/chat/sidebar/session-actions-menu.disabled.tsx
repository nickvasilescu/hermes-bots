import type { ReactNode } from 'react'

interface SessionMenuProps {
  children: ReactNode
  [key: string]: unknown
}

export function SessionActionsMenu({ children }: SessionMenuProps) {
  return <>{children}</>
}

export function SessionContextMenu({ children }: SessionMenuProps) {
  return <>{children}</>
}
