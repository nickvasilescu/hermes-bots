import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Slot as ContribSlot } from '@/contrib/react/slot'
import { PR_COMMENT_URL_RE } from '@/lib/chat-runtime'
import { DATA_IMAGE_URL_RE } from '@/lib/embedded-images'
import { triggerHaptic } from '@/lib/haptics'
import { interceptsTypedVoiceStop } from '@/lib/voice-stop-word'
import { toggleReview } from '@/store/review'
import { $autoSpeakReplies } from '@/store/voice-prefs'

import { AttachmentList } from './attachments'
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
import { COMPOSER_AREAS } from './contrib'
import { onComposerAttachImagesRequest } from './focus'
import { useComposerBranch } from './hooks/use-composer-branch'
import { useComposerDrop } from './hooks/use-composer-drop'
import { useComposerVoice } from './hooks/use-composer-voice'
import { CodingStatusRow } from './status-stack/coding-row'
import { extractClipboardImageBlobs } from './text-utils'
import { VoiceActivity, VoicePlaybackActivity } from './voice-activity'

export const COMPOSER_RUNTIME_CAPABILITIES = Object.freeze({
  attachments: true,
  branch: true,
  drop: true,
  voice: true
})

export function useSkuComposerDrop(args: ComposerDropRuntimeArgs): ComposerDropRuntime {
  return useComposerDrop(args)
}

export function useSkuComposerBranch(args: ComposerBranchRuntimeArgs): ComposerBranchRuntime {
  return useComposerBranch(args)
}

export function useSkuComposerVoice(args: ComposerVoiceRuntimeArgs): ComposerVoiceRuntime {
  return useComposerVoice(args)
}

export function useSkuAutoSpeakReplies(): boolean {
  return useStore($autoSpeakReplies)
}

export function useSkuComposerImageRequests({ onAttachImageBlob, target }: ComposerImageRequestsArgs): void {
  useEffect(() => {
    if (!onAttachImageBlob) {
      return undefined
    }

    return onComposerAttachImagesRequest(({ blobs, target: requestedTarget }) => {
      if (requestedTarget !== target) {
        return
      }

      triggerHaptic('selection')

      for (const blob of blobs) {
        void onAttachImageBlob(blob)
      }
    })
  }, [onAttachImageBlob, target])
}

export function handleSkuComposerPaste({
  event,
  onAttachImageBlob,
  onAttachPrCommentUrl,
  onPasteClipboardImage,
  pastedText
}: ComposerPasteArgs): boolean {
  const imageBlobs = extractClipboardImageBlobs(event.clipboardData)

  if (imageBlobs.length > 0 && onAttachImageBlob) {
    triggerHaptic('selection')

    for (const blob of imageBlobs) {
      void onAttachImageBlob(blob)
    }
  }

  if (!pastedText) {
    event.preventDefault()

    if (imageBlobs.length === 0 && onPasteClipboardImage) {
      triggerHaptic('selection')
      void onPasteClipboardImage({ silent: true })
    }

    return true
  }

  if (DATA_IMAGE_URL_RE.test(pastedText)) {
    event.preventDefault()

    return true
  }

  if (PR_COMMENT_URL_RE.test(pastedText) && onAttachPrCommentUrl?.(pastedText)) {
    event.preventDefault()

    return true
  }

  return false
}

export function shouldInterceptSkuTypedVoiceStop(active: boolean, value: string, attachmentCount: number): boolean {
  return interceptsTypedVoiceStop(active, value, attachmentCount)
}

export function SkuAttachmentList(props: SkuAttachmentListProps) {
  return <AttachmentList {...props} />
}

export function SkuCodingStatusRow({ composerTarget, repoPath, ...props }: SkuCodingStatusRowProps) {
  return (
    <CodingStatusRow
      {...props}
      onOpen={() => toggleReview(composerTarget === 'main' ? null : (repoPath ?? null))}
      repoPath={repoPath}
    />
  )
}

export function SkuVoiceActivity(props: SkuVoiceActivityProps) {
  return <VoiceActivity {...props} />
}

export function SkuVoicePlaybackActivity() {
  return <VoicePlaybackActivity />
}

export function SkuComposerLeadingContributions() {
  return <ContribSlot area={COMPOSER_AREAS.leading} />
}

export function SkuComposerActionContributions() {
  return <ContribSlot area={COMPOSER_AREAS.actions} />
}
