import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownTextContent } from './markdown-text.disabled'

describe('SSH transcript presentation', () => {
  it('renders links, media, and artifact-shaped content as inert text', () => {
    render(
      <MarkdownTextContent isRunning={false} text={'[Open](https://example.com)\n```html\n<button>Run</button>\n```'} />
    )

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy()
  })
})
