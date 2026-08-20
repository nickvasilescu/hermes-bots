import { $connection } from '@/store/session'

import type { BrowserManageResponse } from '../../../types'

import type { GatewayRequest } from './utils'

interface BrowserSlashActionContext {
  arg: string
}

interface BrowserSlashOutput {
  render: (text: string) => void
  sessionId: string
}

export function createBrowserSlashActionHandler<T extends BrowserSlashActionContext>({
  requestGateway,
  withSlashOutput
}: {
  requestGateway: GatewayRequest
  withSlashOutput: (ctx: T) => Promise<BrowserSlashOutput | null>
}) {
  return async (ctx: T): Promise<void> => {
    const resolved = await withSlashOutput(ctx)

    if (!resolved) {return}

    const { render, sessionId } = resolved

    if ($connection.get()?.mode === 'remote') {
      render(
        '/browser manages a Chromium-family browser on the gateway host — only available when connected to a local gateway.'
      )

      return
    }

    const [rawAction = 'status', ...rest] = ctx.arg.trim().split(/\s+/).filter(Boolean)
    const action = rawAction.toLowerCase()

    if (!['connect', 'disconnect', 'status'].includes(action)) {
      render('usage: /browser [connect|disconnect|status] [url] · persistent: set browser.cdp_url in config.yaml')

      return
    }

    const url = action === 'connect' ? rest.join(' ').trim() || 'http://127.0.0.1:9222' : undefined

    if (url) {render(`checking Chromium-family browser remote debugging at ${url}...`)}

    try {
      const result = await requestGateway<BrowserManageResponse>('browser.manage', {
        action,
        session_id: sessionId,
        ...(url && { url })
      })

      result?.messages?.forEach(message => render(message))

      if (action === 'status') {
        render(
          result?.connected
            ? `browser connected: ${result.url || '(url unavailable)'}`
            : 'browser not connected (try /browser connect <url> or set browser.cdp_url in config.yaml)'
        )

        return
      }

      if (action === 'disconnect') {
        render('browser disconnected')

        return
      }

      if (result?.connected) {
        render('Browser connected to live Chromium-family browser via CDP')
        render(`Endpoint: ${result.url || '(url unavailable)'}`)
        render('next browser tool call will use this CDP endpoint')
      }
    } catch (error) {
      render(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
