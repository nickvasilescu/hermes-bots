import { atom } from 'nanostores'

import { workspaceCwdForNewSession } from '@/store/session'

export const ALL_PROJECTS = '__all_projects__'
export const $activeProjectId = atom<null | string>(null)
export const $projects = atom<unknown[]>([])
export const $projectScope = atom(ALL_PROJECTS)
export const $projectTree = atom<unknown[]>([])
export const $projectTreeLoading = atom(false)
export const $projectsRpcAvailable = atom(false)
export const $removedSessionIds = atom<Set<string>>(new Set())
export const $reposScanning = atom(false)
export const $startWorkSessionRequest = atom<null>(null)
export const $worktreeDialog = atom<null>(null)
export const $worktreeRefreshToken = atom(0)

export function tombstoneSessions(ids: Array<null | string | undefined>): void {
  const next = new Set($removedSessionIds.get())

  for (const id of ids) {if (id?.trim()) {next.add(id.trim())}}
  $removedSessionIds.set(next)
}

export function untombstoneSessions(ids: Array<null | string | undefined>): void {
  const next = new Set($removedSessionIds.get())

  for (const id of ids) {if (id?.trim()) {next.delete(id.trim())}}
  $removedSessionIds.set(next)
}

export const beginSessionMutation = (_ids: Array<null | string | undefined>): void => undefined
export const endSessionMutation = (_ids: Array<null | string | undefined>): void => undefined
export const resolveNewSessionCwd = (): string => workspaceCwdForNewSession()
export const followActiveSessionCwd = async (_cwd: string): Promise<void> => undefined
export const openFolderAsProject = async (_dir?: string): Promise<void> => undefined
export const requestStartWorkSession = (_path: string, _draft?: string, _options?: { openTab?: boolean }): void =>
  undefined
export const startWorkInRepo = async (): Promise<null> => null
export const listRepoBranches = async (): Promise<unknown[]> => []
export const listBaseBranches = async (): Promise<unknown[]> => []
export const switchBranchInRepo = async (): Promise<void> => undefined
export const closeWorktreeDialog = (): void => undefined
export const projectNameForCwd = (_cwd: string): null => null
export const projectIdForCwd = (_cwd: string): null => null
export const projectRootCwd = (): string => ''
export const repoDiscoveryPolicyFromConfig = (): null => null
export const repoDiscoveryPolicySignature = (): string => ''
export const scanAndRecordRepos = async (): Promise<void> => undefined
