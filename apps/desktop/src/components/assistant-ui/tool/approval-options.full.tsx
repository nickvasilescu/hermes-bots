import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Translations } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import type { ApprovalRequest } from '@/store/prompts'

type ApprovalChoice = 'session' | 'always' | 'deny'

interface ApprovalMoreOptionsProps {
  busy: boolean
  copy: Translations['assistant']['approval'] & { cancel: string }
  onConfirmChange: (open: boolean) => void
  request: ApprovalRequest
  respond: (choice: ApprovalChoice) => Promise<void>
}

export function ApprovalMoreOptions({ busy, copy, onConfirmChange, request, respond }: ApprovalMoreOptionsProps) {
  const [confirmAlways, setConfirmAlways] = useState(false)
  const allowPermanent = request.allowPermanent !== false
  const choices = request.choices ?? (request.smartDenied ? ['once', 'deny'] : undefined)
  const allowSession = choices ? choices.includes('session') : true
  const allowAlways = choices ? choices.includes('always') : allowPermanent

  if (!allowSession && !allowAlways) {
    return null
  }

  const setConfirm = (open: boolean) => {
    setConfirmAlways(open)
    onConfirmChange(open)
  }

  return (
    <>
      <span aria-hidden className="w-px self-stretch bg-primary/20" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={copy.moreOptions}
            className="h-full w-5 rounded-none px-0 text-primary hover:bg-primary/15 hover:text-primary"
            disabled={busy}
            size="xs"
            variant="ghost"
          >
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {allowSession && (
            <DropdownMenuItem onSelect={() => void respond('session')}>{copy.allowSession}</DropdownMenuItem>
          )}
          {allowAlways && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setConfirm(true), 0)}>
              {copy.alwaysAllowMenu}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void respond('deny')} variant="destructive">
            {copy.reject}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setConfirm} open={confirmAlways}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.alwaysTitle}</DialogTitle>
            <DialogDescription>{copy.alwaysDescription(request.description)}</DialogDescription>
          </DialogHeader>
          {request.command.trim() && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-2.5 py-1.5 font-mono text-xs leading-snug text-foreground">
              {request.command.trim()}
            </pre>
          )}
          <DialogFooter>
            <Button onClick={() => setConfirm(false)} size="sm" variant="ghost">
              {copy.cancel}
            </Button>
            <Button
              onClick={() => {
                setConfirm(false)
                void respond('always')
              }}
              size="sm"
              variant="destructive"
            >
              {copy.alwaysAllow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
