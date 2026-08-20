import { useCallback } from 'react'

export function useCwdActions(_options: unknown) {
  const changeSessionCwd = useCallback(async (_cwd: string) => {}, [])
  const refreshProjectBranch = useCallback(async (_cwd: string) => {}, [])

  return { changeSessionCwd, refreshProjectBranch }
}
