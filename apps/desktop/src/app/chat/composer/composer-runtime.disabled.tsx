import type {
  ComposerBranchRuntime,
  ComposerBranchRuntimeArgs,
  ComposerDropRuntime,
  ComposerDropRuntimeArgs,
  ComposerImageRequestsArgs,
  ComposerPasteArgs,
  ComposerVoiceRuntime,
  ComposerVoiceRuntimeArgs,
  SkuAttachmentListProps,
  SkuCodingStatusRowProps,
  SkuVoiceActivityProps
} from './composer-runtime.types'

export const COMPOSER_RUNTIME_CAPABILITIES = Object.freeze({
  attachments: false,
  branch: false,
  drop: false,
  voice: false
})

const ignore = () => undefined
const ignoreAsync = async () => undefined

const disabledDropRuntime: ComposerDropRuntime = {
  dragActive: false,
  handleDragEnter: undefined,
  handleDragLeave: undefined,
  handleDragOver: undefined,
  handleDrop: undefined,
  handleInputDragOver: undefined,
  handleInputDrop: undefined
}

const disabledBranchRuntime: ComposerBranchRuntime = {
  handleBranchOff: ignoreAsync,
  handleConvertBranch: ignoreAsync,
  handleListBranches: async () => [],
  handleSwitchBranch: ignoreAsync,
  openInWorktree: ignore
}

const disabledVoiceRuntime: ComposerVoiceRuntime = {
  conversation: {
    level: 0,
    muted: false,
    status: 'idle',
    stopTurn: ignore,
    toggleMute: ignore
  },
  dictate: ignore,
  endConversation: ignore,
  handleToggleAutoSpeak: ignore,
  startConversation: ignore,
  voiceActivityState: { elapsedSeconds: 0, level: 0, status: 'idle' },
  voiceConversationActive: false,
  voiceStatus: 'idle'
}

export function useSkuComposerDrop(_args: ComposerDropRuntimeArgs): ComposerDropRuntime {
  return disabledDropRuntime
}

export function useSkuComposerBranch(_args: ComposerBranchRuntimeArgs): ComposerBranchRuntime {
  return disabledBranchRuntime
}

export function useSkuComposerVoice(_args: ComposerVoiceRuntimeArgs): ComposerVoiceRuntime {
  return disabledVoiceRuntime
}

export function useSkuAutoSpeakReplies(): boolean {
  return false
}

export function useSkuComposerImageRequests(_args: ComposerImageRequestsArgs): void {}

export function handleSkuComposerPaste({ event, pastedText }: ComposerPasteArgs): boolean {
  if (!pastedText || /^data:image\//i.test(pastedText)) {
    event.preventDefault()

    return true
  }

  return false
}

export function shouldInterceptSkuTypedVoiceStop(_active: boolean, _value: string, _attachmentCount: number): boolean {
  return false
}

export function SkuAttachmentList(_props: SkuAttachmentListProps) {
  return null
}

export function SkuCodingStatusRow(_props: SkuCodingStatusRowProps) {
  return null
}

export function SkuVoiceActivity(_props: SkuVoiceActivityProps) {
  return null
}

export function SkuVoicePlaybackActivity() {
  return null
}

export function SkuComposerLeadingContributions() {
  return null
}

export function SkuComposerActionContributions() {
  return null
}
