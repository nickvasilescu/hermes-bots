import { ActionBarPrimitive, BranchPickerPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { resolveAgentAvatarProfile } from '@desktop/agent-avatar-client'
import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react'

import { DirectiveContent } from '@/components/assistant-ui/directive-text'
import { messageAttachmentRefs, messageContentText } from '@/components/assistant-ui/thread/content'
import { ReactionBadge, ReactionPicker } from '@/components/assistant-ui/thread/message-reactions'
import { formatMessageTimestamp, shouldShowMessageTimestamp } from '@/components/assistant-ui/thread/timestamp'
import { type RestoreMessageTarget } from '@/components/assistant-ui/thread/types'
import { useMessageReactions } from '@/components/assistant-ui/thread/use-message-reactions'
import { UserMessageText } from '@/components/assistant-ui/thread/user-message-text'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { stripBotGroupContext } from '@/lib/bot-group-chat'
import { triggerHaptic } from '@/lib/haptics'
import { StopFilled } from '@/lib/icons'
import { profileColor } from '@/lib/profile-color'
import { cn } from '@/lib/utils'
import { notifyThreadEditOpen } from '@/store/thread-scroll'
import { isWatchWindow } from '@/store/windows'

/** True when the user has a live text highlight (drag-select / triple-click). */
export function hasTextSelection(): boolean {
  const selection = window.getSelection()

  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0)
}

export function StickyHumanMessageContainer({
  attachments,
  children,
  messageId,
  timestamp
}: {
  attachments?: ReactNode
  children: ReactNode
  messageId?: string
  timestamp?: ReactNode
}) {
  return (
    // Keep the bubble and attachments as flow siblings. User messages scroll
    // normally with the transcript instead of pinning a full-width banner to
    // the top of the conversation.
    <>
      {timestamp}
      <div
        className="group/user-message flex w-full min-w-0 max-w-none flex-col items-end gap-0 self-end overflow-visible pt-1"
        data-message-id={messageId}
        data-role="user"
        data-slot="aui_user-message-root"
      >
        {children}
      </div>
      {attachments}
    </>
  )
}

// Shared "user bubble" base. Both the read-only message and the inline edit
// composer render the same solid, directional surface. The bubble shrink-wraps
// ordinary sent text like Grok Bot/iMessage; the edit composer explicitly
// expands it back to a comfortable editing width.
//
// no-drag: sticky bubbles park at --sticky-human-top (~4px), sliding under the
// titlebar's [-webkit-app-region:drag] strips (app-shell.tsx). Electron resolves
// drag regions at the compositor level — z-index and pointer-events don't help —
// so without the carve-out, clicking a stuck bubble drags the window instead of
// opening the edit composer.
export const USER_BUBBLE_BASE_CLASS =
  'composer-human-message relative ml-auto flex w-fit min-w-0 max-w-[70%] flex-col gap-1 overflow-y-auto rounded-xl border-0 bg-(--ui-user-message-background) px-2 py-0.5 text-left shadow-none [--conversation-text-font-size:10px] [-webkit-app-region:no-drag]'

export const USER_ACTION_ICON_BUTTON_CLASS =
  'grid place-items-center rounded-md bg-transparent text-(--ui-text-secondary) transition-colors hover:bg-(--ui-control-active-background) hover:text-foreground disabled:cursor-default disabled:text-(--ui-text-quaternary) disabled:opacity-70'

export const USER_ACTION_ICON_SIZE = '0.6875rem'
export const StopGlyph = <StopFilled aria-hidden className="size-3.5 -translate-y-px" />

// Background-process notifications are injected into the conversation as user
// messages (the agent must react to them, and message-role alternation forbids
// a synthetic system row mid-loop). They are NOT something the human typed, so
// render them as a compact system-style notice instead of a user bubble.
// Shape: see tools/process_registry.py format_process_notification().
const PROCESS_NOTIFICATION_RE = /^\[IMPORTANT: Background process [\s\S]*\]$/

// Agent-to-agent deliveries ("Message from 🤖 <sender>: …", the Bot Mode /
// multi-profile convention; optional "(@<handle>)" carries the sender's
// profile name for avatar resolution; legacy "[Message from agent
// '<sender>'] …" too). They arrive on the user role because the recipient's
// turn runs on it, but they are NOT the human speaking — render them as a
// compact attributed timeline notice instead of a user bubble.
export const AGENT_MESSAGE_RE =
  /^(?:Message from (?:🤖\s*)?([^:\n(]{1,256}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u

interface AgentAvatarVisual {
  color: string
  image: null | string
  shape: string
}

// Sender handle -> the same image or shape/color identity Bot Mode stores in
// profile ui_meta. Module-level so a transcript full of one bot resolves once.
const agentAvatarCache = new Map<string, AgentAvatarVisual | null>()
const agentAvatarInflight = new Map<string, Promise<AgentAvatarVisual | null>>()
const BOT_AVATAR_SHAPES = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const

function defaultBotAvatarShape(name: string): string {
  let hash = 0

  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }

  return BOT_AVATAR_SHAPES[hash % BOT_AVATAR_SHAPES.length]
}

function darkAvatarColor(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16)

  if (!Number.isFinite(value)) {
    return false
  }

  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 110
}

const BotProfileShape: FC<{ className?: string; color: string; shape: string }> = ({ className, color, shape }) => {
  const body =
    shape === 'squircle' ? (
      <rect fill={color} height="34" rx="11" width="34" x="3" y="3" />
    ) : shape === 'pill' ? (
      <rect fill={color} height="26" rx="13" width="36" x="2" y="7" />
    ) : shape === 'triangle' ? (
      <path d="M20 5.5 L36 33.5 L4 33.5 Z" fill={color} stroke={color} strokeLinejoin="round" strokeWidth="7" />
    ) : shape === 'hexagon' ? (
      <path
        d="M20 3.5 L34.5 11.75 L34.5 28.25 L20 36.5 L5.5 28.25 L5.5 11.75 Z"
        fill={color}
        stroke={color}
        strokeLinejoin="round"
        strokeWidth="7"
      />
    ) : shape === 'cloud' ? (
      <path d="M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z" fill={color} />
    ) : shape === 'drop' ? (
      <path d="M20 3 C20 3 6 20 6 27 a14 13.5 0 0 0 28 0 C34 20 20 3 20 3 Z" fill={color} />
    ) : (
      <circle cx="20" cy="20" fill={color} r="17.5" />
    )

  const eyeY = shape === 'pill' ? 20 : shape === 'triangle' ? 25 : shape === 'cloud' ? 22 : shape === 'drop' ? 24 : 17
  const eyeColor = darkAvatarColor(color) ? '#f8fafc' : '#111827'

  return (
    <svg aria-hidden className={cn('shrink-0', className)} viewBox="0 0 40 40">
      {body}
      <circle cx="14.5" cy={eyeY} fill={eyeColor} r="2.4" />
      <circle cx="25.5" cy={eyeY} fill={eyeColor} r="2.4" />
    </svg>
  )
}

async function resolveAgentAvatar(handle: string): Promise<AgentAvatarVisual | null> {
  const key = handle.trim().toLowerCase()

  if (!key) {
    return null
  }

  if (agentAvatarCache.has(key)) {
    return agentAvatarCache.get(key) ?? null
  }

  const inflight = agentAvatarInflight.get(key)

  if (inflight) {
    return inflight
  }

  const run = (async (): Promise<AgentAvatarVisual | null> => {
    try {
      const profile = await resolveAgentAvatarProfile(key)

      if (!profile) {
        return null
      }

      const meta = profile.ui_meta?.['hermes-bots'] as { color?: unknown; shape?: unknown } | undefined

      return {
        color: typeof meta?.color === 'string' ? meta.color : (profileColor(profile.name) ?? '#9ca3af'),
        image: profile.image,
        shape: typeof meta?.shape === 'string' ? meta.shape : defaultBotAvatarShape(profile.name)
      }
    } catch {
      // Older gateway (no profiles.* RPCs) or transient failure — the 🤖
      // glyph fallback is always correct.
      return null
    } finally {
      agentAvatarInflight.delete(key)
    }
  })()

  agentAvatarInflight.set(key, run)
  const out = await run
  agentAvatarCache.set(key, out)

  return out
}

/** Profile-backed avatar shared by inter-agent notices and Bot Mode group
 * bubbles. It resolves image assets plus Bot Mode's exact shape/color meta. */
export const AgentAvatar: FC<{ className?: string; handle: string }> = ({ className, handle }) => {
  const [avatar, setAvatar] = useState<AgentAvatarVisual | null>(
    () => agentAvatarCache.get(handle.toLowerCase()) ?? null
  )

  useEffect(() => {
    let live = true

    void resolveAgentAvatar(handle).then(visual => {
      if (live && visual) {
        setAvatar(visual)
      }
    })

    return () => {
      live = false
    }
  }, [handle])

  return avatar?.image ? (
    <img alt="" aria-hidden className={cn('shrink-0 rounded-full object-cover', className)} src={avatar.image} />
  ) : avatar ? (
    <BotProfileShape className={className} color={avatar.color} shape={avatar.shape} />
  ) : (
    <BotProfileShape
      className={className}
      color={profileColor(handle) ?? '#9ca3af'}
      shape={defaultBotAvatarShape(handle)}
    />
  )
}

const GROUP_CHAT_SENDER_RE = /^group chat (.*?)(?:\s+\[profiles[=:]\s*([^\]]+)\])?$/i

function fallbackProfileHandle(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || label.trim()
  )
}

export function parseAgentMessageSender(rawSender: string, explicitHandle?: string) {
  const groupSender = GROUP_CHAT_SENDER_RE.exec(rawSender)

  return {
    groupHandles: groupSender
      ? (groupSender[2]?.split(',') ?? groupSender[1].split(',')).map(fallbackProfileHandle).filter(Boolean)
      : [],
    handle: (explicitHandle || rawSender).trim(),
    sender: groupSender ? `group chat ${groupSender[1].trim()}` : rawSender.trim()
  }
}

const AgentMessageNote: FC<{ text: string }> = ({ text }) => {
  const match = AGENT_MESSAGE_RE.exec(text)
  const rawSender = (match?.[1] || match?.[3] || 'agent').trim()
  const { groupHandles, handle, sender } = parseAgentMessageSender(rawSender, match?.[2] || match?.[3])
  const body = (match?.[4] || '').trim()

  // Grok-bots shape: an inter-agent delivery is a timeline EVENT, not a
  // conversation bubble — a subtle centered notice ("Message from 🤖 X"),
  // with the delivered text one click away instead of shouting in the
  // transcript. The recipient's reply below it stays a normal assistant
  // message, so the exchange still reads in order.
  return (
    <div
      className="flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60"
      data-slot="aui_agent-message-note"
    >
      <span className="flex items-center justify-center gap-1.5">
        {groupHandles.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5" data-slot="aui_agent-message-avatar-stack">
            {groupHandles.map((groupHandle, index) => (
              <AgentAvatar className="size-4" handle={groupHandle} key={`${groupHandle}:${index}`} />
            ))}
          </span>
        ) : (
          <AgentAvatar className="size-4" handle={handle} />
        )}
        <span className="wrap-anywhere">Message from {sender}</span>
      </span>
      {body && (
        <details className="self-center">
          <summary className="cursor-pointer select-none text-center text-muted-foreground/45 hover:text-muted-foreground/70">
            show message
          </summary>
          <div className="mt-1 max-w-[36rem] rounded-lg border border-(--ui-stroke-tertiary) px-3 py-2 text-left text-[0.75rem] leading-5 text-foreground/85">
            <UserMessageText text={body} />
          </div>
        </details>
      )}
    </div>
  )
}

const ProcessNotificationNote: FC<{ text: string }> = ({ text }) => {
  const body = text.replace(/^\[IMPORTANT:\s*/, '').replace(/\]$/, '')
  const newline = body.indexOf('\n')
  const headline = (newline === -1 ? body : body.slice(0, newline)).trim()
  const detail = newline === -1 ? '' : body.slice(newline + 1).trim()

  return (
    <div className="flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60">
      <span className="flex items-center gap-1.5">
        <Codicon className="shrink-0 text-muted-foreground/55" name="terminal" size="0.75rem" />
        <span className="wrap-anywhere">{headline}</span>
      </span>
      {detail && (
        <details className="pl-[1.3125rem]">
          <summary className="cursor-pointer select-none text-muted-foreground/45 hover:text-muted-foreground/70">
            output
          </summary>
          <pre
            className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[0.625rem] leading-4 text-muted-foreground/55"
            data-selectable-text="true"
          >
            {detail}
          </pre>
        </details>
      )}
    </div>
  )
}

export const UserMessage: FC<{
  onCancel?: () => Promise<void> | void
  onRequestRestoreConfirm?: (messageId: string, target: RestoreMessageTarget) => void
}> = ({ onCancel, onRequestRestoreConfirm }) => {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const messageId = useAuiState(s => s.message.id)
  const content = useAuiState(s => s.message.content)
  const messageText = stripBotGroupContext(messageContentText(content))
  const threadRunning = useAuiState(s => s.thread.isRunning)

  const timestampMs = useAuiState(s => {
    const index = s.thread.messages.findIndex(message => message.id === s.message.id)
    const value = s.message.createdAt
    const currentMs = value ? new Date(value).getTime() : 0
    const previousValue = index > 0 ? s.thread.messages[index - 1]?.createdAt : undefined
    const previousMs = previousValue ? new Date(previousValue).getTime() : undefined

    return shouldShowMessageTimestamp(currentMs, previousMs) ? currentMs : 0
  })

  const timestampText = timestampMs ? formatMessageTimestamp(timestampMs, copy).replace(', ', ' ') : ''

  const latestUserId = useAuiState(s => {
    for (let i = s.thread.messages.length - 1; i >= 0; i--) {
      const message = s.thread.messages[i] as { id?: string; role?: string }

      if (message.role === 'user') {
        return message.id ?? null
      }
    }

    return null
  })

  const runtimeUserOrdinal = useAuiState(s => {
    let ordinal = 0

    for (const message of s.thread.messages) {
      if (message.role !== 'user') {
        continue
      }

      if (message.id === s.message.id) {
        return ordinal
      }

      ordinal += 1
    }

    return null
  })

  const attachmentRefs = useAuiState(s => {
    const custom = (s.message.metadata?.custom ?? {}) as { attachmentRefs?: unknown }

    return messageAttachmentRefs(custom.attachmentRefs)
  })

  const [pickerOpen, setPickerOpen] = useState(false)
  const { enabled: reactionsEnabled, react, reactions: shownReactions } = useMessageReactions(messageId, 'user')

  const pickEmoji = useCallback(
    (emoji: null | string) => {
      setPickerOpen(false)
      react(emoji)
    },
    [react]
  )

  // Watch windows spectate a subagent run driven elsewhere — prompts can't be
  // edited, restored, or stopped from here.
  const readOnly = isWatchWindow()

  // Injected background-process notification, not a human prompt — render the
  // compact system-style notice (after all hooks above have run).
  if (PROCESS_NOTIFICATION_RE.test(messageText.trim())) {
    return (
      <MessagePrimitive.Root
        className="flex w-full min-w-0 flex-col items-stretch"
        data-role="user"
        data-slot="aui_user-message-root"
      >
        <ProcessNotificationNote text={messageText.trim()} />
      </MessagePrimitive.Root>
    )
  }

  // Agent-to-agent delivery, not a human prompt — attributed inter-agent card.
  if (AGENT_MESSAGE_RE.test(messageText.trim())) {
    return (
      <MessagePrimitive.Root
        className="flex w-full min-w-0 flex-col items-stretch pb-(--conversation-turn-gap)"
        data-role="user"
        data-slot="aui_user-message-root"
      >
        <AgentMessageNote text={messageText.trim()} />
      </MessagePrimitive.Root>
    )
  }

  const hasBody = messageText.trim().length > 0
  const isLatestUser = messageId === latestUserId
  const showStop = !readOnly && isLatestUser && threadRunning && Boolean(onCancel)
  // Restore (re-run this exact prompt) is available everywhere the Stop button
  // isn't — including mid-stream on older prompts, since the action interrupts
  // the live turn before rewinding.
  const showRestore = !readOnly && !showStop && Boolean(onRequestRestoreConfirm) && hasBody

  const bubbleClassName = cn(
    USER_BUBBLE_BASE_CLASS,
    'cursor-pointer text-[10px] leading-[1.35] text-(--orgo-ink) transition-[background-color] hover:bg-(--ui-user-message-hover-background)'
  )

  const bubbleContent = hasBody && (
    // Render the user's text through a minimal markdown pipeline:
    // backtick `code` and ``` fenced ``` blocks, with directive chips
    // (`@file:` etc.) still resolved inside the plain-text spans.
    <div>
      <UserMessageText className="wrap-anywhere" text={messageText} />
    </div>
  )

  return (
    <MessagePrimitive.Root asChild>
      <StickyHumanMessageContainer
        attachments={
          // Attachments live BELOW the sticky bubble in normal flow, so they
          // scroll away behind the pinned bubble instead of riding along with
          // it. Image refs render as thumbnails, file refs as chips; no border.
          attachmentRefs.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1 -mt-3 mb-2">
              <DirectiveContent text={attachmentRefs.join(' ')} />
            </div>
          ) : null
        }
        messageId={messageId}
        timestamp={
          timestampText ? (
            <div
              className="w-full py-0.5 text-center text-[9px] font-medium tabular-nums text-(--ui-text-quaternary)"
              data-slot="aui_message-timestamp"
            >
              {timestampText}
            </div>
          ) : null
        }
      >
        <ActionBarPrimitive.Root className="relative w-full max-w-full" data-slot="aui_user-bubble-actions">
          <div className="human-message-with-todos-wrapper flex w-full flex-col gap-0">
            <ReactionPicker
              onOpenChange={setPickerOpen}
              onSelect={pickEmoji}
              open={pickerOpen}
              selected={shownReactions.find(reaction => reaction.author === 'user')?.emoji}
            >
              <div
                className="relative w-full"
                onContextMenu={
                  // Right-click is the desktop stand-in for iOS touch-and-hold —
                  // but only when there's nothing selected. A live highlight
                  // keeps the native Copy menu (and ⌘C) instead of the picker.
                  readOnly || !reactionsEnabled
                    ? undefined
                    : event => {
                        if (hasTextSelection()) {
                          return
                        }

                        event.preventDefault()
                        setPickerOpen(true)
                      }
                }
              >
                {readOnly ? (
                  // Spectator transcript: fully readable, but never editable.
                  <div className={cn(bubbleClassName, 'cursor-default')} data-slot="aui_user-message-bubble">
                    {bubbleContent}
                  </div>
                ) : (
                  // Always editable — clicking opens the edit composer even while a
                  // turn streams; sending the edit reverts (interrupt + rewind).
                  // A live text highlight wins: finishing a drag-select must not
                  // open the editor and throw the selection away.
                  <ActionBarPrimitive.Edit asChild>
                    <button
                      aria-label={copy.editMessage}
                      className={bubbleClassName}
                      data-slot="aui_user-message-bubble"
                      onClick={event => {
                        if (hasTextSelection()) {
                          event.preventDefault()
                          event.stopPropagation()

                          return
                        }

                        triggerHaptic('selection')
                      }}
                      onPointerDown={() => {
                        if (hasTextSelection()) {
                          return
                        }

                        notifyThreadEditOpen()
                      }}
                      type="button"
                    >
                      {bubbleContent}
                    </button>
                  </ActionBarPrimitive.Edit>
                )}
                {(showStop || showRestore) && (
                  <div className="pointer-events-none absolute right-full bottom-1/2 z-10 mr-1 flex translate-y-1/2 items-center justify-center opacity-0 transition-opacity group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100">
                    {showStop ? (
                      <button
                        aria-label={copy.stop}
                        className={cn('pointer-events-auto size-5', USER_ACTION_ICON_BUTTON_CLASS)}
                        onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          void onCancel?.()
                        }}
                        title={copy.stop}
                        type="button"
                      >
                        {StopGlyph}
                      </button>
                    ) : (
                      <button
                        aria-label={copy.restoreCheckpoint}
                        className={cn('pointer-events-auto size-6', USER_ACTION_ICON_BUTTON_CLASS)}
                        onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          triggerHaptic('selection')
                          onRequestRestoreConfirm?.(messageId, {
                            text: messageText,
                            userOrdinal: runtimeUserOrdinal
                          })
                        }}
                        onPointerDown={event => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        title={copy.restoreFromHere}
                        type="button"
                      >
                        <Codicon name="discard" size="0.875rem" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </ReactionPicker>
            {/* Below the bubble, same register as the assistant action row:
                same emoji size, same vertical padding, right-aligned to the
                sent bubble. Overlaying the corner read badly in practice. */}
            <ReactionBadge
              className="justify-end gap-1.5 py-1.5 pr-1.5"
              onRetract={() => react(null)}
              reactions={shownReactions}
            />
            <BranchPickerPrimitive.Root
              className={cn(
                'checkpoint-container flex items-center gap-1 pb-0 pt-1 pl-1.5 text-[0.75rem] leading-none text-(--ui-text-tertiary)',
                readOnly && 'hidden'
              )}
              hideWhenSingleBranch
            >
              <span aria-hidden className="checkpoint-icon size-1.5 rounded-full border border-current" />
              <BranchPickerPrimitive.Previous
                className="checkpoint-restore-text rounded-sm bg-transparent px-1 opacity-65 hover:opacity-100 disabled:hidden disabled:cursor-default"
                title={copy.restorePrevious}
              >
                {copy.restoreCheckpoint}
              </BranchPickerPrimitive.Previous>
              <span className="checkpoint-divider opacity-55">
                <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
              </span>
              <BranchPickerPrimitive.Next
                className="checkpoint-restore-text rounded-sm bg-transparent px-1 opacity-65 hover:opacity-100 disabled:hidden disabled:cursor-default"
                title={copy.restoreNext}
              >
                {copy.goForward}
              </BranchPickerPrimitive.Next>
            </BranchPickerPrimitive.Root>
          </div>
        </ActionBarPrimitive.Root>
      </StickyHumanMessageContainer>
    </MessagePrimitive.Root>
  )
}
