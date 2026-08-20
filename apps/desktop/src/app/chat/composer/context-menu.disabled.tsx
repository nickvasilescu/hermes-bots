import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { MessageSquareText } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type { ContextMenuProps } from './context-menu'

const SNIPPET_KEYS = ['codeReview', 'implementationPlan', 'explainThis'] as const

const SNIPPET_BUTTON = cn(
  'size-(--composer-control-size) shrink-0 rounded-md',
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

export function ContextMenu({ onInsertText }: ContextMenuProps) {
  const { t } = useI18n()
  const c = t.composer
  const [open, setOpen] = useState(false)

  return (
    <>
      <Tip label={c.promptSnippets} side="top">
        <Button
          aria-label={c.promptSnippets}
          className={SNIPPET_BUTTON}
          onClick={() => setOpen(true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MessageSquareText className="size-3.5" />
        </Button>
      </Tip>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{c.snippetsTitle}</DialogTitle>
            <DialogDescription>{c.snippetsDesc}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1">
            {SNIPPET_KEYS.map(key => {
              const snippet = c.snippets[key]

              return (
                <li key={key}>
                  <button
                    className="group/snippet flex w-full cursor-pointer items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) focus-visible:border-(--ui-stroke-tertiary) focus-visible:bg-(--ui-control-hover-background) focus-visible:outline-none"
                    onClick={() => {
                      onInsertText(snippet.text)
                      setOpen(false)
                    }}
                    type="button"
                  >
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary) group-hover/snippet:text-foreground" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-medium text-foreground">{snippet.label}</span>
                      <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                        {snippet.description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
