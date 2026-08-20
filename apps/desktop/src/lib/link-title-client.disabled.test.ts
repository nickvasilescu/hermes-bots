import { describe, expect, it, vi } from 'vitest'

import { fetchLinkTitle, isTitleFetchable, useLinkTitle } from './link-title-client.disabled'

describe('disabled link-title client', () => {
  it('never calls a desktop or network bridge', async () => {
    const bridge = vi.fn().mockResolvedValue('unexpected')
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { fetchLinkTitle: bridge } })

    expect(isTitleFetchable('https://example.com/redirect?to=http://169.254.169.254')).toBe(false)
    await expect(fetchLinkTitle('http://127.0.0.1/admin')).resolves.toBe('')
    expect(useLinkTitle('https://[::1]/')).toBe('')
    expect(bridge).not.toHaveBeenCalled()

    Reflect.deleteProperty(window, 'hermesDesktop')
  })
})
