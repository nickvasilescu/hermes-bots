import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ModelRefreshFooter } from './model-refresh-footer.disabled'

describe('SSH model picker', () => {
  it('does not expose the provider-discovery refresh action', () => {
    const { container } = render(<ModelRefreshFooter />)

    expect(container.innerHTML).toBe('')
  })
})
