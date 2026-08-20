import { describe, expect, it, vi } from 'vitest'

import { dispatchUnknownSlashCommand } from './ssh-slash-dispatch.disabled'

describe('SSH-only slash dispatch', () => {
  it.each(['browser', 'Browser', ' BROWSER ', 'handoff', 'DEBUG', 'rollback', 'stop', 'tools', 'unknown-skill'])(
    'fails closed for %j without dispatching to the Mini',
    async command => {
      const requestGateway = vi.fn(async () => undefined)

      await dispatchUnknownSlashCommand(command, requestGateway)

      expect(requestGateway).not.toHaveBeenCalled()
    }
  )
})
