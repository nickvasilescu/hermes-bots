import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  handleSkuComposerPaste,
  shouldInterceptSkuTypedVoiceStop,
  COMPOSER_RUNTIME_CAPABILITIES as sshCapabilities,
  useSkuComposerBranch,
  useSkuComposerDrop,
  useSkuComposerVoice
} from './composer-runtime.disabled'
import { COMPOSER_RUNTIME_CAPABILITIES as fullCapabilities } from './composer-runtime.full'

const hookArgs = {
  branch: { clearDraft: vi.fn(), cwd: '/repo', draftRef: { current: 'draft' } },
  drop: {
    cwd: '/repo',
    insertInlineRefs: vi.fn(() => true),
    onAttachDroppedItems: vi.fn(),
    requestMainFocus: vi.fn()
  },
  voice: {
    busy: false,
    clearDraft: vi.fn(),
    disabled: false,
    focusInput: vi.fn(),
    insertText: vi.fn(),
    maxRecordingSeconds: 120,
    onInterrupt: vi.fn(),
    onSubmit: vi.fn(() => true),
    onTranscribeAudio: vi.fn(),
    sessionId: 'session',
    target: 'main' as const
  }
}

describe('composer runtime SKU selection', () => {
  it('declares the full runtime and the SSH text-only runtime explicitly', () => {
    expect(fullCapabilities).toEqual({ attachments: true, branch: true, drop: true, voice: true })
    expect(sshCapabilities).toEqual({ attachments: false, branch: false, drop: false, voice: false })
  })

  it('keeps voice, drop, branch, attachment, and coding modules out of the SSH runtime graph', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/chat/composer/composer-runtime.disabled.tsx'),
      'utf8'
    )

    const chatBarSource = fs.readFileSync(path.join(process.cwd(), 'src/app/chat/composer/index.tsx'), 'utf8')

    expect(source).not.toContain("from './hooks/use-composer-voice'")
    expect(source).not.toContain("from './hooks/use-composer-drop'")
    expect(source).not.toContain("from './hooks/use-composer-branch'")
    expect(source).not.toContain("from './status-stack/coding-row'")
    expect(source).not.toContain("from './attachments'")
    expect(source).not.toContain("from './voice-activity'")
    expect(source).not.toContain("from '@/store/review'")
    expect(chatBarSource).not.toContain("from '@/store/review'")
  })

  it('returns inert voice, drop, and branch adapters', async () => {
    const drop = useSkuComposerDrop(hookArgs.drop)
    const voice = useSkuComposerVoice(hookArgs.voice)
    const branch = useSkuComposerBranch(hookArgs.branch)

    expect(drop).toMatchObject({
      dragActive: false,
      handleDragEnter: undefined,
      handleDrop: undefined,
      handleInputDrop: undefined
    })
    expect(voice).toMatchObject({ voiceConversationActive: false, voiceStatus: 'idle' })
    expect(await branch.handleListBranches()).toEqual([])
    expect(shouldInterceptSkuTypedVoiceStop(true, 'stop', 0)).toBe(false)
  })

  it('does not call image or attachment callbacks from the SSH paste seam', () => {
    const preventDefault = vi.fn()
    const onAttachImageBlob = vi.fn()
    const onAttachPrCommentUrl = vi.fn()
    const onPasteClipboardImage = vi.fn()

    const consumed = handleSkuComposerPaste({
      event: { preventDefault } as never,
      onAttachImageBlob,
      onAttachPrCommentUrl,
      onPasteClipboardImage,
      pastedText: 'ordinary text'
    })

    expect(consumed).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onAttachImageBlob).not.toHaveBeenCalled()
    expect(onAttachPrCommentUrl).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).not.toHaveBeenCalled()
  })
})
