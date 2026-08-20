import { describe, expect, it } from 'vitest'

import { desktopDefaultCwd, readDesktopFileDataUrl, selectDesktopPaths } from './desktop-fs.disabled'

describe('SSH local file seam', () => {
  it('does not resolve renderer-supplied host paths', async () => {
    await expect(readDesktopFileDataUrl('/run/korgo-ssh/identity')).resolves.toBe('')
    await expect(selectDesktopPaths()).resolves.toEqual([])
    await expect(desktopDefaultCwd()).resolves.toBeNull()
  })
})
