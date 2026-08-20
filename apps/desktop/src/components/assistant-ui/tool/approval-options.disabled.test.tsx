import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApprovalMoreOptions } from './approval-options.disabled'

describe('SSH approval options', () => {
  it('does not render persistent or session-wide approval actions', () => {
    const { container } = render(<ApprovalMoreOptions />)

    expect(container.innerHTML).toBe('')
  })
})
