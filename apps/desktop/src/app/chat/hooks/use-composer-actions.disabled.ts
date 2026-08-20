import { useCallback, useMemo } from 'react'

import { requestComposerInsert } from '@/app/chat/composer/focus'
import { removeComposerAttachment } from '@/store/composer'

export function useComposerActions(_options: Record<string, unknown>) {
  const addTextToDraft = useCallback((text: string) => requestComposerInsert(text), [])
  const unavailable = useCallback(async () => undefined, [])

  const removeAttachment = useCallback((id: string) => {
    removeComposerAttachment(id)
  }, [])

  return useMemo(
    () => ({
      addContextRefAttachment: unavailable,
      addTerminalSelectionAttachment: unavailable,
      addTextToDraft,
      attachContextFilePath: unavailable,
      attachContextFolderPath: unavailable,
      attachDroppedItems: unavailable,
      attachImageBlob: unavailable,
      attachImagePath: unavailable,
      attachPrCommentUrl: unavailable,
      insertContextPathInlineRef: unavailable,
      pasteClipboardImage: unavailable,
      pickContextPaths: unavailable,
      pickImages: unavailable,
      removeAttachment
    }),
    [addTextToDraft, removeAttachment, unavailable]
  )
}
