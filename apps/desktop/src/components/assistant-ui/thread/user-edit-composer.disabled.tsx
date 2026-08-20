import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react'

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'

export function UserEditComposer(_props: { cwd: string | null; gateway: unknown; sessionId: string | null }) {
  const aui = useAui()
  const { t } = useI18n()
  const canSubmit = useAuiState(state => state.composer.text.trim().length > 0)

  return (
    <ComposerPrimitive.Root className="ml-auto flex w-full max-w-[70%] items-end gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) p-2">
      <ComposerPrimitive.Input
        aria-label={t.assistant.thread.editMessage}
        autoFocus
        className="max-h-48 min-h-8 min-w-0 flex-1 resize-none bg-transparent text-[length:var(--conversation-text-font-size)] text-foreground/95 outline-none"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            aui.composer().cancel()
          }
        }}
        submitMode="enter"
      />
      <button
        aria-label={t.assistant.thread.sendEdited}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-(--chrome-action-hover) disabled:opacity-40"
        disabled={!canSubmit}
        onClick={() => aui.composer().send()}
        type="button"
      >
        <Codicon name="arrow-up" size="0.875rem" />
      </button>
    </ComposerPrimitive.Root>
  )
}
