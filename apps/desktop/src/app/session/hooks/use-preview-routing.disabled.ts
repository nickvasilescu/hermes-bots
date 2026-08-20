import { useCallback } from 'react'

interface PreviewRoutingOptions<Event> {
  baseHandleGatewayEvent: (event: Event) => void
}

export function usePreviewRouting<Event>({ baseHandleGatewayEvent }: PreviewRoutingOptions<Event>) {
  const restartPreviewServer = useCallback(async (_url: string, _context?: string) => {
    throw new Error('Preview is unavailable in the SSH client.')
  }, [])

  return { handleDesktopGatewayEvent: baseHandleGatewayEvent, restartPreviewServer }
}
