import { useCallback } from 'react'

export function useHermesConfig(_options: unknown) {
  const refreshHermesConfig = useCallback(async (_force = false) => {}, [])

  return { refreshHermesConfig, sttEnabled: false, voiceMaxRecordingSeconds: undefined }
}
