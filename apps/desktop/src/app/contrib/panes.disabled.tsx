import { atom } from 'nanostores'

import type { GroupSetter } from '@/app/shell/group-setter'
import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import type { TitlebarTool } from '@/app/shell/titlebar-controls'

export const $restartPreviewServer = atom<((url: string, context?: string) => Promise<string>) | null>(null)

export function FilesPane(): null {
  return null
}

export function LogsPane(): null {
  return null
}

export function ReviewPaneContent(): null {
  return null
}

export function useStatusbarContributions(_side: 'left' | 'right'): StatusbarItem[] {
  return []
}

export function useTitlebarToolContributions(_side: 'left' | 'right'): TitlebarTool[] {
  return []
}

export function registryGroupSetter<T>(_prefix: string): GroupSetter<T> {
  return () => {}
}

export const setStatusbarItemGroup = registryGroupSetter<StatusbarItem>('statusBar')
export const setTitlebarToolGroup = registryGroupSetter<TitlebarTool>('titleBar.tools')
