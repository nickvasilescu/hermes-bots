import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatBarState } from '@/app/chat/composer/types'
import { I18nProvider } from '@/i18n'

import { ContextMenu } from './context-menu.disabled'
import { ComposerControls } from './controls.disabled'

vi.mock('./model-pill', () => ({ ModelPill: () => <span data-testid="model-pill" /> }))

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: true, label: 'Add context' },
  voice: { active: false, enabled: true }
}

const controlProps: React.ComponentProps<typeof ComposerControls> = {
  autoSpeak: true,
  busy: false,
  busyAction: 'stop',
  canSubmit: true,
  conversation: {
    active: false,
    level: 0,
    muted: false,
    onEnd: vi.fn(),
    onStart: vi.fn(),
    onStopTurn: vi.fn(),
    onToggleMute: vi.fn(),
    status: 'idle'
  },
  disabled: false,
  hasComposerPayload: true,
  onDictate: vi.fn(),
  onQueue: vi.fn(),
  onToggleAutoSpeak: vi.fn(),
  state,
  voiceStatus: 'idle'
}

function renderUi(node: React.ReactNode) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      {node}
    </I18nProvider>
  )
}

afterEach(cleanup)

describe('SSH-only composer controls', () => {
  it('renders only model and send controls while idle', () => {
    renderUi(<ComposerControls {...controlProps} />)

    expect(screen.getByTestId('model-pill')).toBeTruthy()
    expect(screen.getByLabelText('Send')).toBeTruthy()
    expect(screen.queryByLabelText('Voice dictation')).toBeNull()
    expect(screen.queryByLabelText('Start voice conversation')).toBeNull()
    expect(screen.queryByLabelText(/Wake word:/)).toBeNull()
  })

  it('retains the text queue action while steering', () => {
    const onQueue = vi.fn()
    renderUi(<ComposerControls {...controlProps} busy busyAction="steer" onQueue={onQueue} />)

    fireEvent.click(screen.getByLabelText('Queue message'))
    expect(onQueue).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Steer the current run')).toBeTruthy()
  })
})

describe('SSH-only prompt snippets', () => {
  it('replaces the attachment plus menu with a working snippet button', async () => {
    const onInsertText = vi.fn()
    renderUi(
      <ContextMenu
        onInsertText={onInsertText}
        onOpenUrlDialog={vi.fn()}
        onPasteClipboardImage={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFolders={vi.fn()}
        onPickImages={vi.fn()}
        state={state}
      />
    )

    expect(screen.queryByLabelText('Add context')).toBeNull()
    fireEvent.click(screen.getByLabelText('Prompt snippets…'))
    expect(await screen.findByRole('heading', { name: 'Prompt snippets' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Code review/ }))
    expect(onInsertText).toHaveBeenCalledWith('Please review this for bugs, regressions, and missing tests.')
  })
})
