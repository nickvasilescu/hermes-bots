import type { ClipboardEvent, MutableRefObject, DragEvent as ReactDragEvent } from 'react'

import type { HermesGitBranch } from '@/global'
import type { ComposerAttachment } from '@/store/composer'

import type { ComposerTarget } from './focus'
import type { ConversationStatus } from './hooks/use-voice-conversation'
import type { InlineRefInput } from './inline-refs'
import type { ChatBarProps, VoiceActivityState, VoiceStatus } from './types'

export interface ComposerDropRuntimeArgs {
  cwd: ChatBarProps['cwd']
  insertInlineRefs: (refs: InlineRefInput[]) => boolean
  onAttachDroppedItems: ChatBarProps['onAttachDroppedItems']
  requestMainFocus: () => void
}

export interface ComposerDropRuntime {
  dragActive: boolean
  handleDragEnter?: (event: ReactDragEvent<HTMLFormElement>) => void
  handleDragLeave?: (event: ReactDragEvent<HTMLFormElement>) => void
  handleDragOver?: (event: ReactDragEvent<HTMLFormElement>) => void
  handleDrop?: (event: ReactDragEvent<HTMLFormElement>) => void
  handleInputDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  handleInputDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
}

export interface ComposerBranchRuntimeArgs {
  clearDraft: () => void
  cwd: null | string | undefined
  draftRef: MutableRefObject<string>
}

export interface ComposerBranchRuntime {
  handleBranchOff: (branch: string, base?: string) => Promise<void>
  handleConvertBranch: (branch: string, path?: null | string, isDefault?: boolean) => Promise<void>
  handleListBranches: () => Promise<HermesGitBranch[]>
  handleSwitchBranch: (branch: string) => Promise<void>
  openInWorktree: (path: string) => void
}

export interface ComposerVoiceRuntimeArgs {
  busy: boolean
  clearDraft: () => void
  disabled: boolean
  focusInput: () => void
  insertText: (text: string) => void
  maxRecordingSeconds: number
  onInterrupt?: () => Promise<void> | void
  onSubmit: ChatBarProps['onSubmit']
  onTranscribeAudio: ChatBarProps['onTranscribeAudio']
  sessionId: string | null | undefined
  target: ComposerTarget
}

export interface ComposerVoiceRuntime {
  conversation: {
    level: number
    muted: boolean
    status: ConversationStatus
    stopTurn: () => void
    toggleMute: () => void
  }
  dictate: () => void
  endConversation: () => void
  handleToggleAutoSpeak: () => void
  startConversation: () => void
  voiceActivityState: VoiceActivityState
  voiceConversationActive: boolean
  voiceStatus: VoiceStatus
}

export interface ComposerImageRequestsArgs {
  onAttachImageBlob: ChatBarProps['onAttachImageBlob']
  target: ComposerTarget
}

export interface ComposerPasteArgs {
  event: ClipboardEvent<HTMLDivElement>
  onAttachImageBlob: ChatBarProps['onAttachImageBlob']
  onAttachPrCommentUrl: ChatBarProps['onAttachPrCommentUrl']
  onPasteClipboardImage: ChatBarProps['onPasteClipboardImage']
  pastedText: string
}

export interface SkuAttachmentListProps {
  attachments: ComposerAttachment[]
  onRemove?: (id: string) => void
}

export interface SkuCodingStatusRowProps {
  composerTarget: ComposerTarget
  onBranchOff?: (branch: string, base?: string) => Promise<void>
  onConvertBranch?: (branch: string, path?: null | string, isDefault?: boolean) => Promise<void>
  onListBranches?: () => Promise<HermesGitBranch[]>
  onOpenWorktree?: (path: string) => void
  onSwitchBranch?: (branch: string) => Promise<void>
  repoPath?: null | string
}

export interface SkuVoiceActivityProps {
  state: VoiceActivityState
}
