/**
 * Hermes Bot Mode — a "one chat per agent" roster for the Hermes desktop.
 *
 * Left pane "Bots": one row per Hermes profile (a bot = an agent profile) with
 * a customizable avatar (shape + color + eyes, image, or pet). Click opens that
 * bot's chat; right-click → Edit Profile or Delete.
 * "New" opens a Grok-style To: picker. One recipient resumes that bot's
 * forever chat; two or more recipients create a persistent group chat.
 * Each bot has exactly one session — extra tabs are not part of this UI.
 *
 * Bots message each other straight into each bot's ONE canonical "Bot
 * Chat" — @-mentions deliver over gateway RPCs (no CLI relay), and
 * bot-initiated sends use `hermes -p <bot> chat -c "Bot Chat"`.
 * Group turns reuse that same handoff path and render each attributed reply
 * as its own conversation bubble.
 */

import {
  atom,
  Button,
  BOT_GROUP_CONTEXT_END,
  BOT_GROUP_CONTEXT_START,
  BOT_GROUP_REPLY_END,
  botGroupReplyStart,
  CHAT_HEADER_AREA,
  Checkbox,
  cn,
  Codicon,
  COMPOSER_AREAS,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  GlyphSpinner,
  haptic,
  host,
  Input,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  profileColor,
  queryClient,
  relativeTime,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Tip,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { syncConnectorsForRoster } from '@desktop/bot-integration-sync'
import { IMAGE_UNAVAILABLE_COPY } from '@desktop/bot-image-unavailable-copy'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-bots'
const ROSTER_KEY = [ID, 'roster']
const ROUTINES_KEY = [ID, 'routines']
const GROUPS_STORAGE_KEY = 'bot-groups-v1'
const PINNED_STORAGE_KEY = 'bot-pins-v1'
const DELETED_STORAGE_KEY = 'bot-deleted-v1'
const FIRST_BOT_PROFILE_EVENT = 'hermes-bots:first-profile'
const CANONICAL_CHAT_TITLE = 'Bot Chat'
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Captured in register() so components can reach plugin storage. */
let pluginCtx = null

/** Live roster snapshot for imperative handlers (context menus). */
const $lastRoster = atom([])

/** Bots with chat activity the user hasn't seen yet (name -> true).
 *  Fed by the roster poll's activity watermark, so it catches EVERY
 *  delivery path: RPC, CLI (bot-to-bot), cron runs, other machines. */
const $botUnread = atom({})

// last_active watermark per bot, seeded on first poll so a fresh mount
// doesn't mark ancient history unread.
const rosterWatermarks = new Map()
let watermarksSeeded = false

/** Detect new inbound activity from a fresh roster: last_active moved past
 *  the watermark for a bot whose chat isn't on screen -> unread + toast. */
function trackInboundActivity(roster) {
  const seeding = !watermarksSeeded
  watermarksSeeded = true

  for (const bot of roster) {
    const ts = bot.last_session?.last_active || 0
    const prev = rosterWatermarks.get(bot.name) || 0
    rosterWatermarks.set(bot.name, Math.max(prev, ts))

    if (seeding || ts <= prev) {
      continue
    }

    // Activity in the bot the user is currently looking at is already
    // visible — never badge the open chat.
    if ($selectedBot.get() === bot.name) {
      continue
    }

    const meta = $botMeta.get()[bot.name]
    const label = displayName(bot, meta)
    const preview = (bot.last_session?.preview || '').trim()
    const inbound = /^Message from/i.test(preview)

    $botUnread.set({ ...$botUnread.get(), [bot.name]: true })
    host.notify({
      kind: 'info',
      title: inbound ? `\uD83E\uDD16 New message for ${label}` : `${label} has new activity`,
      message: preview.slice(0, 140) || 'Open the chat to see it.'
    })
  }
}

/** Bot the Routines tile is scoped to. Follows the live gateway profile
 *  (the bot you're actually chatting with) and roster clicks. */
const $selectedBot = atom('default')

/** Per-bot appearance + display meta, persisted via ctx.storage:
 *  { [botName]: { shape, color, title } } */
const $botMeta = atom({})
let botMetaRevision = 0

/** Persistent Grok-style group conversations. A group owns one normal Hermes
 * session under its first profile; the hidden routing envelope fans a turn to
 * every participant and the renderer expands the attributed replies. */
const $botGroups = atom({})
const $newConversation = atom(null)
const $activeGroupId = atom(null)
const runtimeGroupIds = new Map()
let pendingGroupId = null

/** Pinned bots, newest pin last. Pinned agents lift out of the conversation
 *  list into a tile strip at the top — the roster's "these are my regulars"
 *  shelf, which is how Grok Bot surfaces its own. */
const $pinnedBots = atom([])
const BOT_DRAG_TYPE = 'application/x-hermes-bot-profile'
let draggedBotName = null
let pinnedBotsRevision = 0

function savePinnedBots(next) {
  pinnedBotsRevision += 1
  $pinnedBots.set(next)

  try {
    Promise.resolve(pluginCtx?.storage?.set?.(PINNED_STORAGE_KEY, next)).catch(() => undefined)
  } catch {
    /* storage unavailable — pins hold for this window */
  }
}

function pinBotFirst(name) {
  const current = $pinnedBots.get()
  const next = [name, ...current.filter(entry => entry !== name)]

  if (next.length !== current.length || next.some((entry, index) => entry !== current[index])) {
    savePinnedBots(next)
  }
}

function toggleBotPin(name) {
  const current = $pinnedBots.get()

  haptic('tap')
  savePinnedBots(current.includes(name) ? current.filter(entry => entry !== name) : [...current, name])
}

function movePinnedBot(name, beforeName = null) {
  const current = $pinnedBots.get()
  const next = current.filter(entry => entry !== name)
  const targetIndex = beforeName ? next.indexOf(beforeName) : -1

  next.splice(targetIndex >= 0 ? targetIndex : next.length, 0, name)

  if (next.length !== current.length || next.some((entry, index) => entry !== current[index])) {
    haptic('selection')
    savePinnedBots(next)
  }
}

function unpinBot(name) {
  const current = $pinnedBots.get()

  if (current.includes(name)) {
    haptic('selection')
    savePinnedBots(current.filter(entry => entry !== name))
  }
}

function startBotDrag(event, name) {
  draggedBotName = name

  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(BOT_DRAG_TYPE, name)
    event.dataTransfer.setData('text/plain', name)
  }
}

function readDraggedBot(event) {
  return event?.dataTransfer?.getData(BOT_DRAG_TYPE) || draggedBotName || ''
}

function finishBotDrag() {
  draggedBotName = null
}

function saveBotGroups(next) {
  $botGroups.set(next)

  try {
    Promise.resolve(pluginCtx?.storage?.set?.(GROUPS_STORAGE_KEY, next)).catch(() => undefined)
  } catch {
    /* storage unavailable — groups remain available for this window */
  }
}

function forgetGroupRuntimes(groupId) {
  if (!groupId) {
    return
  }

  for (const [runtimeId, id] of runtimeGroupIds) {
    if (id === groupId) {
      runtimeGroupIds.delete(runtimeId)
    }
  }
}

function patchBotGroup(id, patch) {
  const current = $botGroups.get()[id]

  if (!current) {
    return null
  }

  const nextGroup = { ...current, ...patch }
  saveBotGroups({ ...$botGroups.get(), [id]: nextGroup })

  return nextGroup
}

function saveBotMeta(name, patch) {
  const next = {
    ...$botMeta.get(),
    [name]: { ...($botMeta.get()[name] || {}), ...patch }
  }

  botMetaRevision += 1
  $botMeta.set(next)

  // Local plugin storage: instant, and the fallback for older gateways.
  try {
    Promise.resolve(pluginCtx?.storage?.set?.('bot-meta', next)).catch(() => undefined)
  } catch {
    /* storage unavailable — look persists for this window only */
  }

  // Server-side (source of truth when supported): profile.yaml ui_meta,
  // namespaced under this plugin's id — every client machine sees the same
  // roster. Older gateways reject the param shape; that's fine, local wins.
  // Data-URL fields are stripped from ui_meta (64KB cap, rides every
  // profiles.list); the avatar IMAGE goes to the profile asset store
  // instead (profiles.set_asset), which is server-side and uncapped by the
  // list call — so pfps follow the profile across machines too.
  try {
    const { image, pet, ...rest } = next[name] || {}
    host.request('profiles.configure', { name, ui_meta: { 'hermes-bots': rest } }).catch(() => undefined)
  } catch {
    /* older gateway */
  }

  // Avatar image → profile asset store (feature-detected; local storage
  // remains the fallback rendering source on older gateways).
  if ('image' in patch) {
    try {
      const req = patch.image
        ? host.request('profiles.set_asset', {
            name,
            asset: 'avatar',
            data: patch.image
          })
        : host.request('profiles.set_asset', {
            name,
            asset: 'avatar',
            clear: true
          })
      req.catch(() => undefined)
    } catch {
      /* older gateway */
    }
  }
}

/** Fetch server-side avatars for roster rows flagged has_avatar when the
 *  local cache doesn't already have an image for them. Fire-and-forget. */
const avatarFetchInflight = new Set()

function pullServerAvatars(roster) {
  for (const bot of roster) {
    if (!bot.has_avatar || avatarFetchInflight.has(bot.name)) {
      continue
    }

    if ($botMeta.get()[bot.name]?.image) {
      continue
    }

    avatarFetchInflight.add(bot.name)
    host
      .request('profiles.get_asset', { name: bot.name, asset: 'avatar' })
      .then(res => {
        if (res?.found && res.data) {
          const current = $botMeta.get()
          $botMeta.set({
            ...current,
            [bot.name]: { ...(current[bot.name] || {}), image: res.data }
          })

          try {
            Promise.resolve(pluginCtx?.storage?.set?.('bot-meta', $botMeta.get())).catch(() => undefined)
          } catch {
            /* no storage */
          }
        }
      })
      .catch(() => undefined)
      .finally(() => avatarFetchInflight.delete(bot.name))
  }
}

/** Server ui_meta (per roster row) beats local storage for the compact
 *  fields it carries; local-only fields (avatar image data URL, extracted
 *  pet icon) are PRESERVED — the server copy never includes them, so a
 *  naive replace would wipe a just-saved image avatar on the next roster
 *  paint. Local also fills gaps for older gateways. */
function mergeServerMeta(roster) {
  const local = $botMeta.get()
  let changed = false
  const next = { ...local }

  for (const bot of roster) {
    const server = bot.ui_meta?.['hermes-bots']
    if (server && typeof server === 'object') {
      const mine = next[bot.name] || {}
      const merged = { ...mine, ...server }

      // Local-only fields survive the server overlay.
      if (mine.image) {
        merged.image = mine.image
      }

      // Local session handoffs reach the renderer before profiles.configure
      // necessarily reaches profiles.list. Keep the foreground pin while that
      // server copy catches up, including /new and compression rotations.
      if (
        mine.chat &&
        (pendingExplicitNewSession?.name === bot.name || routedStoredSessionId() === mine.chat)
      ) {
        merged.chat = mine.chat
      }

      if (JSON.stringify(next[bot.name] || null) !== JSON.stringify(merged)) {
        next[bot.name] = merged
        changed = true
      }
    }
  }

  if (changed) {
    $botMeta.set(next)
  }
}

/** Clone a bot: profile (config/skills/SOUL/memory via clone_from) + look.
 *  Name is "<base>-2", "-3", … — first free slot against the live roster. */
async function duplicateBot(bot, roster) {
  const base = bot.name
  let name = null
  for (let n = 2; n < 100; n++) {
    // Truncate the BASE, never the suffix — slicing the joined string chops
    // the "-2" off a max-length name and the candidate collides with the
    // base forever (#19).
    const suffix = `-${n}`
    const candidate = base.slice(0, 64 - suffix.length) + suffix
    if (!roster.some(b => b.name === candidate)) {
      name = candidate
      break
    }
  }

  if (!name) {
    throw new Error('No free name for the duplicate.')
  }

  await host.request('profiles.create', {
    name,
    clone_from: base,
    description: bot.description || ''
  })
  clearDeletedBotTombstone(name)

  // Same look: avatar shape/color/image, pet, and a "(copy)" title so the
  // two are tellable apart in the roster until the user renames.
  const meta = $botMeta.get()[base]
  if (meta) {
    saveBotMeta(name, {
      ...meta,
      title: meta.title ? `${meta.title} (copy)` : ''
    })
  }

  syncConnectorsForRoster([...(roster || []), { name }], { force: true })
  return name
}

function isProtectedProfile(name) {
  return String(name || '').trim().toLowerCase() === 'default'
}

/** Live gateway sessions keep `state.db` open. SQLite then mkdir's the
 *  profile folder back into existence after `hermes profile delete`, which
 *  is why a deleted bot vanished and immediately reappeared. Persist the
 *  name so Cmd+R cannot restore it from `profiles.list`, and hide it from
 *  the roster while we close those sessions and retry the CLI delete. */
let deletedBots = {}
const liveBotRuntimes = new Map()
const canonicalKickoffs = new Map()
const zombieDeletesInFlight = new Set()
const zombieDeleteAttempts = new Map()

function persistDeletedBots() {
  try {
    const storage = typeof pluginCtx !== 'undefined' ? pluginCtx?.storage : null
    const key = typeof DELETED_STORAGE_KEY !== 'undefined' ? DELETED_STORAGE_KEY : 'bot-deleted-v1'
    Promise.resolve(storage?.set?.(key, deletedBots)).catch(() => undefined)
  } catch {
    /* storage unavailable — in-memory tombstones still hide for this window */
  }
}

function hydrateDeletedBots(value) {
  const next = {}

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, at] of Object.entries(value)) {
      if (!name || isProtectedProfile(name)) {
        continue
      }

      next[name] = typeof at === 'number' ? at : Date.now()
    }
  }

  deletedBots = next
}

function tombstoneDeletedBot(name) {
  if (!name || isProtectedProfile(name)) {
    return
  }

  deletedBots = { ...deletedBots, [name]: Date.now() }
  persistDeletedBots()
}

function clearDeletedBotTombstone(name) {
  if (!name || !deletedBots[name]) {
    return
  }

  const next = { ...deletedBots }
  delete next[name]
  deletedBots = next
  persistDeletedBots()
}

function isRecentlyDeleted(name) {
  return Boolean(name && deletedBots[name])
}

function filterDeletedRoster(roster) {
  if (!Array.isArray(roster)) {
    return roster
  }

  return roster.filter(bot => !isRecentlyDeleted(bot.name))
}

function cliExecFailed(result) {
  const payload = result?.result && typeof result.result === 'object' ? result.result : result

  if (payload?.blocked) {
    return payload.hint || 'Delete was blocked by the gateway.'
  }

  const code = payload?.code
  const output = String(payload?.output || '')

  if (typeof code === 'number' && code !== 0) {
    return output.trim().slice(-400) || `Delete failed (exit ${code})`
  }

  if (/\bcancelled\b/i.test(output) && !/deleted/i.test(output)) {
    return output.trim().slice(-400) || 'Delete was cancelled.'
  }

  return null
}

/** Pure local cleanup after a profile is gone. Kept free of host/storage so
 *  the suite can pin the roster/group/pin fallout without a gateway. */
function forgetDeletedBotState(name, state) {
  const meta = { ...(state.meta || {}) }
  delete meta[name]

  const unread = { ...(state.unread || {}) }
  delete unread[name]

  const pins = (state.pins || []).filter(entry => entry !== name)
  const roster = (state.roster || []).filter(bot => bot.name !== name)

  let activeGroupId = state.activeGroupId || null
  const groups = {}
  for (const [id, group] of Object.entries(state.groups || {})) {
    const participantIds = (group.participantIds || []).filter(entry => entry !== name)
    if (participantIds.length < 2) {
      if (activeGroupId === id) {
        activeGroupId = null
      }
      continue
    }

    groups[id] = { ...group, participantIds }
  }

  let draft = state.draft || null
  if (draft?.participantIds?.includes(name)) {
    const participantIds = draft.participantIds.filter(entry => entry !== name)
    draft = participantIds.length ? { ...draft, participantIds } : null
  }

  return {
    meta,
    unread,
    pins,
    roster,
    groups,
    draft,
    activeGroupId,
    selected: state.selected === name ? 'default' : state.selected
  }
}

/** Drop members that are no longer on the live roster. Groups that fall below
 *  two people disappear — a group chat with one leftover bot is just a 1:1.
 *  Covers deletes that happened outside this UI (CLI, another machine). */
function pruneGoneGroupMembers(state, liveNames) {
  const names = new Set(liveNames || [])
  let changed = false
  let activeGroupId = state.activeGroupId || null
  const groups = {}

  for (const [id, group] of Object.entries(state.groups || {})) {
    const previous = group.participantIds || []
    const participantIds = previous.filter(entry => names.has(entry))

    if (participantIds.length !== previous.length) {
      changed = true
    }

    if (participantIds.length < 2) {
      if (activeGroupId === id) {
        activeGroupId = null
      }
      changed = true
      continue
    }

    groups[id] =
      participantIds.length === previous.length && participantIds.every((entry, index) => entry === previous[index])
        ? group
        : { ...group, participantIds }
  }

  let draft = state.draft || null
  if (draft?.participantIds) {
    const participantIds = draft.participantIds.filter(entry => names.has(entry))
    if (participantIds.length !== draft.participantIds.length) {
      changed = true
      draft = participantIds.length ? { ...draft, participantIds } : null
    }
  }

  return { groups, draft, activeGroupId, changed }
}

function forgetDeletedBot(name) {
  const wasOpen = $selectedBot.get() === name
  const next = forgetDeletedBotState(name, {
    meta: $botMeta.get(),
    unread: $botUnread.get(),
    pins: $pinnedBots.get(),
    roster: $lastRoster.get(),
    groups: $botGroups.get(),
    draft: $newConversation.get(),
    activeGroupId: $activeGroupId.get(),
    selected: $selectedBot.get()
  })

  $botMeta.set(next.meta)
  $botUnread.set(next.unread)
  $lastRoster.set(next.roster)
  $selectedBot.set(next.selected)
  $newConversation.set(next.draft)
  $activeGroupId.set(next.activeGroupId)
  savePinnedBots(next.pins)

  const groups = {}
  for (const [id, group] of Object.entries(next.groups)) {
    groups[id] = { ...group, title: groupTitle(group.participantIds, next.roster) }
  }
  saveBotGroups(groups)

  try {
    Promise.resolve(pluginCtx?.storage?.set?.('bot-meta', next.meta)).catch(() => undefined)
  } catch {
    /* storage unavailable — in-memory drop still holds for this window */
  }

  queryClient.invalidateQueries({ queryKey: ROSTER_KEY })

  if (wasOpen) {
    void openBotChat(botFromRoster('default'))
  }
}

function pruneGroupsAgainstRoster(roster) {
  if (!Array.isArray(roster) || roster.length === 0) {
    return
  }

  const wasOpen = $activeGroupId.get()
  const next = pruneGoneGroupMembers(
    {
      groups: $botGroups.get(),
      draft: $newConversation.get(),
      activeGroupId: wasOpen
    },
    roster.map(bot => bot.name)
  )

  if (!next.changed) {
    return
  }

  const groups = {}
  for (const [id, group] of Object.entries(next.groups)) {
    groups[id] = { ...group, title: groupTitle(group.participantIds, roster) }
  }
  saveBotGroups(groups)
  $newConversation.set(next.draft)
  $activeGroupId.set(next.activeGroupId)

  if (wasOpen && !next.activeGroupId) {
    void openBotChat(botFromRoster('default'))
  }
}

function deleteBotGroup(group) {
  const id = group?.id
  if (!id) {
    return
  }

  const wasOpen = $activeGroupId.get() === id
  const next = { ...$botGroups.get() }
  delete next[id]
  saveBotGroups(next)

  if (wasOpen) {
    $activeGroupId.set(null)
    void openBotChat(botFromRoster('default'))
  }
}

function abortCanonicalChat(name) {
  const timer = canonicalKickoffs.get(name)

  if (timer) {
    window.clearTimeout(timer)
    canonicalKickoffs.delete(name)
  }
}

async function closeLiveSessionsForBot(bot) {
  const name = bot?.name
  const storedIds = new Set()
  const metaChat = $botMeta.get()[name]?.chat

  if (metaChat) {
    storedIds.add(metaChat)
  }

  if (bot?.last_session?.id) {
    storedIds.add(bot.last_session.id)
  }

  try {
    const listed = await host.request('session.list', { profile: name, limit: 100 })

    for (const session of listed?.sessions || []) {
      if (session?.id) {
        storedIds.add(session.id)
      }
    }
  } catch {
    /* profile may already be gone */
  }

  const toClose = new Set()
  const tracked = liveBotRuntimes.get(name)

  if (tracked) {
    toClose.add(tracked)
  }

  try {
    const live = await host.request('session.active_list', {})

    for (const row of live?.sessions || []) {
      if (storedIds.has(row.session_key) || storedIds.has(row.id)) {
        toClose.add(row.id)
      }
    }
  } catch {
    /* older gateway — closing the tracked runtime still helps */
  }

  await Promise.all(
    [...toClose].map(id =>
      host.request('session.close', { session_id: id }).catch(() => undefined)
    )
  )
  liveBotRuntimes.delete(name)
}

async function profileStillListed(name) {
  try {
    const res = await host.request('profiles.list', { include_sessions: false })

    return (res?.profiles || []).some(bot => bot.name === name)
  } catch {
    return false
  }
}

async function runProfileDeleteCli(name) {
  const result = await host.request('cli.exec', {
    argv: ['profile', 'delete', '-y', name]
  })
  const failed = cliExecFailed(result)

  if (failed) {
    throw new Error(failed)
  }
}

async function deleteBotProfile(bot) {
  const name = bot?.name
  if (isProtectedProfile(name)) {
    throw new Error('The default profile cannot be deleted.')
  }

  // Tombstone before the CLI so an in-flight Bot Chat create cannot
  // reopen state.db underneath the delete.
  tombstoneDeletedBot(name)
  abortCanonicalChat(name)

  if ($selectedBot.get() === name) {
    void openBotChat(botFromRoster('default'))
  }

  await closeLiveSessionsForBot(bot)
  await runProfileDeleteCli(name)

  if (await profileStillListed(name)) {
    await closeLiveSessionsForBot(bot)
    await new Promise(resolve => window.setTimeout(resolve, 400))
    await runProfileDeleteCli(name)
  }

  if (await profileStillListed(name)) {
    throw new Error(
      'This bot’s chat is still open on the gateway, which keeps recreating the profile. Close the chat and delete again.'
    )
  }

  forgetDeletedBot(name)
  syncConnectorsForRoster(filterDeletedRoster($lastRoster.get()), { force: true })
  return name
}

function DeleteBotDialog({ bot, open, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const meta = useValue($botMeta)[bot?.name]
  const [seedKey, setSeedKey] = useState(null)
  const currentKey = bot && open ? bot.name : null

  if (currentKey !== seedKey) {
    setSeedKey(currentKey)
    setBusy(false)
    setError(null)
  }

  if (!bot) {
    return null
  }

  const label = displayName(bot, meta)
  const confirm = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await deleteBotProfile(bot)
      host.notify({
        kind: 'success',
        message: `Deleted ${label}`
      })
      onClose()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return jsx(Dialog, {
    open,
    onOpenChange: value => !value && !busy && onClose(),
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: `Delete ${label}?` }),
            jsx(DialogDescription, {
              children: `This permanently removes the ${bot.name} profile — config, memory, skills, and chat history. Groups that only exist because of this bot go with it.`
            })
          ]
        }),
        error
          ? jsx('div', {
              className:
                'rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive',
              children: error
            })
          : null,
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              variant: 'ghost',
              disabled: busy,
              onClick: onClose,
              children: 'Cancel'
            }),
            jsx(Button, {
              variant: 'destructive',
              disabled: busy,
              onClick: confirm,
              children: busy ? 'Deleting…' : 'Delete'
            })
          ]
        })
      ]
    })
  })
}

function DeleteGroupDialog({ group, open, onClose }) {
  const [busy, setBusy] = useState(false)

  if (!group) {
    return null
  }

  const confirm = () => {
    if (busy) {
      return
    }

    setBusy(true)
    deleteBotGroup(group)
    host.notify({
      kind: 'success',
      message: 'Deleted group chat'
    })
    onClose()
  }

  return jsx(Dialog, {
    open,
    onOpenChange: value => !value && !busy && onClose(),
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Delete this group chat?' }),
            jsx(DialogDescription, {
              children: `${group.title || 'This group'} is only a conversation on this Mac. The bots themselves stay. You can start a new group with them later.`
            })
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              variant: 'ghost',
              disabled: busy,
              onClick: onClose,
              children: 'Cancel'
            }),
            jsx(Button, {
              variant: 'destructive',
              disabled: busy,
              onClick: confirm,
              children: 'Delete group'
            })
          ]
        })
      ]
    })
  })
}

function deleteMenuItems(bot, onDelete) {
  if (isProtectedProfile(bot.name) || typeof onDelete !== 'function') {
    return []
  }

  return [
    jsx(ContextMenuSeparator, {}, `${bot.name}-delete-sep`),
    jsx(ContextMenuItem, {
      variant: 'destructive',
      onSelect: () => onDelete(bot),
      children: 'Delete'
    }, `${bot.name}-delete`)
  ]
}

// ── avatars (shape + color + eyes) ──────────────────────────────────────────

// The original flat shapes. Sigils ('sigil-N') and platonic
// solids remain render-only so any bot that picked one during the experiments
// keeps its look.
const AVATAR_SHAPES = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop']

/** xorshift PRNG seeded from a string — stable across sessions/platforms. */
function sigilRng(text) {
  let h = 2166136261
  for (const ch of text) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0 || 88675123
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

/**
 * Angular hermetic sigil: strokes on the left half of a 5-column grid,
 * mirrored right, plus a chance of a diamond ring. Returns SVG path strings.
 */
function sigilGeometry(name, seed) {
  const rng = sigilRng(`${name}::${seed}`)
  const gx = i => 6 + i * 7 // 5 cols: 6..34
  const gy = j => 8 + j * 6 // 5 rows: 8..32
  const strokes = []
  const segments = 4 + Math.floor(rng() * 3)

  for (let k = 0; k < segments; k++) {
    const x1 = Math.floor(rng() * 3) // left half incl. center
    const y1 = Math.floor(rng() * 5)
    const x2 = Math.min(2, Math.max(0, x1 + (rng() > 0.5 ? 1 : -1)))
    const y2 = Math.min(4, Math.max(0, y1 + Math.floor(rng() * 3) - 1))

    strokes.push(`M${gx(x1)} ${gy(y1)} L${gx(x2)} ${gy(y2)}`)
    // mirror (col i → col 4-i)
    strokes.push(`M${gx(4 - x1)} ${gy(y1)} L${gx(4 - x2)} ${gy(y2)}`)

    // occasional cross-tie through the axis for connectedness
    if (rng() > 0.6) {
      strokes.push(`M${gx(x2)} ${gy(y2)} L${gx(4 - x2)} ${gy(y2)}`)
    }
  }

  // spine down the axis grounds every variant
  strokes.push(`M20 ${gy(0)} L20 ${gy(4)}`)

  const ring = rng() > 0.45 ? 'M20 4 L36 20 L20 36 L4 20 Z' : null
  return { strokes: strokes.join(' '), ring }
}

const AVATAR_COLORS = [
  '#f5f5f4', // white
  '#8d6748', // brown
  '#ef4444', // red
  '#f97316', // orange
  '#14b8a6', // teal
  '#38bdf8', // cyan
  '#3b40c8', // royal blue
  '#8b5cf6', // violet
  '#ec4899', // magenta
  '#9ca3af' // silver
]

/** Perceptual luminance — eyes/pupils flip light on dark bodies (ink, oxblood). */
function isDarkColor(hex) {
  try {
    const n = parseInt(hex.slice(1), 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
  } catch {
    return false
  }
}

function defaultShapeFor(name) {
  let hash = 0
  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }
  return AVATAR_SHAPES[hash % AVATAR_SHAPES.length]
}

/** The colored body of the avatar (no eyes). Platonic solids are a filled
 *  silhouette + translucent internal edge lines (the projected wireframe);
 *  legacy flat shapes keep their old geometry so stored picks still render. */
function shapeNode(shape, color, botName = 'agent') {
  if (shape.startsWith('sigil-')) {
    const seed = Number(shape.slice(6)) || 0
    const { strokes, ring } = sigilGeometry(botName, seed)
    const sw = {
      fill: 'none',
      stroke: color,
      strokeWidth: 2.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    }
    return jsxs('g', {
      children: [
        ring
          ? jsx('path', {
              d: ring,
              fill: 'none',
              stroke: color,
              strokeWidth: 1.2,
              opacity: 0.5
            })
          : null,
        jsx('path', { d: strokes, ...sw })
      ]
    })
  }

  const stroke = {
    fill: color,
    stroke: color,
    strokeWidth: 7,
    strokeLinejoin: 'round'
  }
  const edge = {
    fill: 'none',
    stroke: 'rgba(0,0,0,0.4)',
    strokeWidth: 1.4,
    strokeLinejoin: 'round',
    strokeLinecap: 'round'
  }
  const face = {
    fill: color,
    stroke: 'rgba(0,0,0,0.4)',
    strokeWidth: 1.4,
    strokeLinejoin: 'round'
  }

  switch (shape) {
    // ── platonic solids ──
    case 'tetrahedron':
      return jsxs('g', {
        children: [
          jsx('path', { d: 'M20 5 L36 33 L4 33 Z', ...face }),
          jsx('path', {
            d: 'M20 5 L20 25 M4 33 L20 25 M36 33 L20 25',
            ...edge
          })
        ]
      })
    case 'cube':
      return jsxs('g', {
        children: [
          jsx('path', {
            d: 'M20 4 L33 11 L33 29 L20 36 L7 29 L7 11 Z',
            ...face
          }),
          jsx('path', { d: 'M7 11 L20 18 L33 11 M20 18 L20 36', ...edge })
        ]
      })
    case 'octahedron':
      return jsxs('g', {
        children: [
          jsx('path', { d: 'M20 3 L36 20 L20 37 L4 20 Z', ...face }),
          jsx('path', { d: 'M4 20 L36 20 M20 3 L20 37', ...edge })
        ]
      })
    case 'dodecahedron':
      return jsxs('g', {
        children: [
          jsx('path', {
            d: 'M20 3 L30 6.2 L36.2 14.7 L36.2 25.3 L30 33.8 L20 37 L10 33.8 L3.8 25.3 L3.8 14.7 L10 6.2 Z',
            ...face
          }),
          jsx('path', {
            d:
              'M20 12 L27.6 17.5 L24.7 26.5 L15.3 26.5 L12.4 17.5 Z ' +
              'M20 12 L20 3 M27.6 17.5 L36.2 14.7 M24.7 26.5 L30 33.8 M15.3 26.5 L10 33.8 M12.4 17.5 L3.8 14.7',
            ...edge
          })
        ]
      })
    case 'icosahedron':
      return jsxs('g', {
        children: [
          jsx('path', {
            d: 'M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z',
            ...face
          }),
          jsx('path', {
            d:
              'M20 11 L27.8 24.5 L12.2 24.5 Z ' +
              'M20 11 L20 3 M20 11 L34.7 11.5 M20 11 L5.3 11.5 ' +
              'M27.8 24.5 L34.7 11.5 M27.8 24.5 L34.7 28.5 M27.8 24.5 L20 37 ' +
              'M12.2 24.5 L5.3 11.5 M12.2 24.5 L5.3 28.5 M12.2 24.5 L20 37',
            ...edge
          })
        ]
      })

    // ── legacy flat shapes (stored picks from earlier versions) ──
    case 'squircle':
      return jsx('rect', {
        x: 3,
        y: 3,
        width: 34,
        height: 34,
        rx: 11,
        fill: color
      })
    case 'pill':
      return jsx('rect', {
        x: 2,
        y: 7,
        width: 36,
        height: 26,
        rx: 13,
        fill: color
      })
    case 'triangle':
      return jsx('path', { d: 'M20 5.5 L36 33.5 L4 33.5 Z', ...stroke })
    case 'hexagon':
      return jsx('path', {
        d: 'M20 3.5 L34.5 11.75 L34.5 28.25 L20 36.5 L5.5 28.25 L5.5 11.75 Z',
        ...stroke
      })
    case 'cloud':
      return jsx('path', {
        d: 'M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z',
        fill: color
      })
    case 'drop':
      return jsx('path', {
        d: 'M20 3 C20 3 6 20 6 27 a14 13.5 0 0 0 28 0 C34 20 20 3 20 3 Z',
        fill: color
      })
    default:
      return jsx('circle', { cx: 20, cy: 20, r: 17.5, fill: color })
  }
}

const EYE_Y = {
  // solids: eyes sit on the upper face region, clear of the busiest edges
  tetrahedron: 26,
  cube: 22.5,
  octahedron: 14.5,
  dodecahedron: 20,
  icosahedron: 17.5,
  // legacy
  circle: 17,
  squircle: 17,
  pill: 20,
  triangle: 25,
  hexagon: 17,
  cloud: 22,
  drop: 24
}

// Solids draw eyes slightly tighter so they read as ON a face.
const EYE_X = {
  tetrahedron: [16.5, 23.5],
  cube: [15, 25],
  octahedron: [16, 24],
  dodecahedron: [16.5, 23.5],
  icosahedron: [16.5, 23.5]
}

/**
 * The face. `mood`: 'idle' (blinks every few seconds), 'work' (eyes scan
 * left-right), 'error' (X X). Eyes flip light-on-dark for ink/oxblood bodies.
 */
function BotFace({ shape, color, image, size = 36, name = 'agent', mood = 'idle' }) {
  const [blink, setBlink] = useState(false)
  const [scanX, setScanX] = useState(0)

  useEffect(() => {
    if (mood === 'work') {
      // scan: pupils sweep left → right → left
      let dir = 1
      let x = 0
      const t = setInterval(() => {
        x += dir
        if (x >= 2 || x <= -2) {
          dir = -dir
        }
        setScanX(x)
      }, 180)
      return () => clearInterval(t)
    }

    if (mood === 'idle') {
      // blink: 120ms closed, randomized 3-7s apart
      let closeTimer = null
      const schedule = () => {
        closeTimer = setTimeout(
          () => {
            setBlink(true)
            setTimeout(() => {
              setBlink(false)
              schedule()
            }, 120)
          },
          3000 + Math.random() * 4000
        )
      }
      schedule()
      return () => clearTimeout(closeTimer)
    }

    return undefined
  }, [mood])

  // A custom image (uploaded or generated) replaces the vector face.
  if (image) {
    return jsx('img', {
      src: image,
      alt: '',
      'aria-hidden': true,
      style: {
        width: size,
        height: size,
        borderRadius: '22%',
        objectFit: 'cover',
        display: 'block'
      }
    })
  }

  const isSigil = shape.startsWith('sigil-')
  const eyeY = isSigil ? 14 : (EYE_Y[shape] ?? 17)
  const [eyeL, eyeR] = isSigil ? [16, 24] : (EYE_X[shape] ?? [15.5, 24.5])
  // Sigils are line art (no fill behind the eyes) → eyes in the sigil color.
  // Filled bodies: dark eyes on light colors, parchment eyes on dark colors.
  const eyeFill = isSigil ? color : isDarkColor(color) ? 'rgba(232,220,195,0.95)' : 'rgba(0,0,0,0.85)'

  const eyes =
    mood === 'error'
      ? jsx('path', {
          d:
            `M${eyeL - 2} ${eyeY - 2} L${eyeL + 2} ${eyeY + 2} M${eyeL + 2} ${eyeY - 2} L${eyeL - 2} ${eyeY + 2} ` +
            `M${eyeR - 2} ${eyeY - 2} L${eyeR + 2} ${eyeY + 2} M${eyeR + 2} ${eyeY - 2} L${eyeR - 2} ${eyeY + 2}`,
          stroke: eyeFill,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          fill: 'none'
        })
      : blink
        ? jsx('path', {
            d: `M${eyeL - 2.2} ${eyeY} L${eyeL + 2.2} ${eyeY} M${eyeR - 2.2} ${eyeY} L${eyeR + 2.2} ${eyeY}`,
            stroke: eyeFill,
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            fill: 'none'
          })
        : jsxs('g', {
            children: [
              jsx('circle', {
                cx: eyeL + scanX,
                cy: eyeY,
                r: 2.4,
                fill: eyeFill
              }),
              jsx('circle', {
                cx: eyeR + scanX,
                cy: eyeY,
                r: 2.4,
                fill: eyeFill
              })
            ]
          })

  return jsxs('svg', {
    viewBox: '0 0 40 40',
    width: size,
    height: size,
    'aria-hidden': true,
    style: { display: 'block', flexShrink: 0, overflow: 'visible' },
    children: [shapeNode(shape, color, name), eyes]
  })
}

function botAppearance(name, meta) {
  return {
    shape: meta?.shape || defaultShapeFor(name),
    color: meta?.color || profileColor(name),
    image: meta?.image || null
  }
}

// ── image avatars: upload from device + generate via image.generate ─────────

/** Downscale to a small square so plugin storage stays light. */
function normalizeAvatarImage(dataUrl, edge = 256) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = edge
        canvas.height = edge
        const ctx2d = canvas.getContext('2d')
        const side = Math.min(img.width, img.height)
        ctx2d.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, edge, edge)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function pickImageFromDevice() {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.onchange = () => {
      const file = input.files?.[0]

      if (!file) {
        return resolve(null)
      }

      if (file.size > 15_000_000) {
        host.notify({ kind: 'error', message: 'Image too large (max 15MB).' })
        return resolve(null)
      }

      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

/** Cached probe: does the gateway have an image backend? A `false` answer
 *  is re-checked on every dialog open — the gateway may have been restarted
 *  (picking up image.generate) or a backend enabled since the last probe.
 *  Only `true` is sticky. */
const $imagenAvailable = atom(null)
let imagenProbeInflight = null

function probeImagen() {
  if (imagenProbeInflight) {
    return imagenProbeInflight
  }

  imagenProbeInflight = host
    .request('image.generate', { probe: true })
    .then(res => $imagenAvailable.set(Boolean(res?.available)))
    .catch(() => $imagenAvailable.set(false))
    .finally(() => {
      imagenProbeInflight = null
    })

  return imagenProbeInflight
}

async function generateAvatarImage(bot, title, description) {
  const who = [title || bot, description].filter(Boolean).join(' — ')
  const res = await host.request('image.generate', {
    prompt:
      `Cute minimal robot avatar for an AI agent named "${who}". ` +
      'Friendly simple mascot face, bold flat vector style, solid color background, centered, no text.',
    aspect_ratio: 'square'
  })

  if (!res?.success) {
    throw new Error(res?.error || 'generation failed')
  }

  // image_data (data URL) works over local AND remote gateways; the raw
  // backend URL is the fallback when the gateway couldn't inline it.
  return res.image_data || res.image
}

/** Shape grid + color swatches, shared by Edit Profile and New Agent.
 *  Layout uses inline grid styles — arbitrary Tailwind classes like
 *  `grid-cols-7` are NOT in the app's precompiled CSS, which collapsed
 *  this into a single vertical column. */
function AvatarPicker({ shape, color, image, onShape, onColor, onImage, generateSeed }) {
  const pickerName = generateSeed?.name || 'agent'
  const imagen = useValue($imagenAvailable)
  const [tab, setTab] = useState('bot')
  const [describe, setDescribe] = useState('')
  const [genBusy, setGenBusy] = useState(false)

  if (imagen === null) {
    void probeImagen()
  }

  // Re-check a stale "unavailable" whenever the user lands on the Generate
  // tab — the gateway may have restarted with image.generate since.
  const goTab = id => {
    setTab(id)

    if (id === 'generate' && $imagenAvailable.get() === false) {
      $imagenAvailable.set(null)
      void probeImagen()
    }
  }

  const upload = async () => {
    const raw = await pickImageFromDevice()

    if (raw) {
      onImage(await normalizeAvatarImage(raw))
    }
  }

  const generate = async () => {
    if (genBusy) {
      return
    }

    setGenBusy(true)

    try {
      const custom = describe.trim()
      const img = custom
        ? await (async () => {
            const res = await host.request('image.generate', {
              prompt: `${custom}. Avatar for an AI agent: centered, bold flat vector style, solid color background, no text.`,
              aspect_ratio: 'square'
            })

            if (!res?.success) {
              throw new Error(res?.error || 'generation failed')
            }

            return res.image_data || res.image
          })()
        : await generateAvatarImage(generateSeed?.name || 'agent', generateSeed?.title, generateSeed?.description)

      if (img) {
        onImage(await normalizeAvatarImage(img))
      }
    } catch (err) {
      host.notifyError(err, 'Avatar generation failed')
    } finally {
      setGenBusy(false)
    }
  }

  const tabButton = (id, label) =>
    jsx(
      'button',
      {
        type: 'button',
        className: cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
          tab === id
            ? 'bg-(--chrome-action-hover) text-foreground'
            : 'text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)'
        ),
        onClick: () => goTab(id),
        children: label
      },
      id
    )

  return jsxs('div', {
    className: 'grid justify-items-center gap-3',
    children: [
      // Tab pills: Bot | Generate | Upload | Pet
      jsxs('div', {
        className: 'flex items-center gap-1',
        children: [
          tabButton('bot', 'Bot'),
          tabButton('generate', 'Generate'),
          tabButton('upload', 'Upload'),
          tabButton('pet', 'Pet')
        ]
      }),

      image && tab !== 'generate'
        ? jsx(Button, {
            type: 'button',
            variant: 'ghost',
            size: 'sm',
            onClick: () => onImage(null),
            children: 'Remove image — use shape'
          })
        : null,

      tab === 'bot'
        ? jsxs('div', {
            className: 'grid justify-items-center gap-3',
            children: [
              jsx('div', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '6px',
                  justifyItems: 'center'
                },
                children: AVATAR_SHAPES.map(s =>
                  jsx(
                    'button',
                    {
                      type: 'button',
                      className: cn(
                        'flex items-center justify-center rounded-md transition-colors hover:bg-(--chrome-action-hover)',
                        s === shape && !image && 'ring-1 ring-(--ui-accent)'
                      ),
                      style: { width: 44, height: 44 },
                      onClick: () => {
                        onImage(null)
                        onShape(s)
                      },
                      children: jsx(BotFace, {
                        shape: s,
                        color,
                        size: 32,
                        name: pickerName
                      })
                    },
                    s
                  )
                )
              }),
              jsx('div', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gap: '8px',
                  justifyItems: 'center'
                },
                children: AVATAR_COLORS.map(c =>
                  jsx(
                    'button',
                    {
                      type: 'button',
                      className: cn(
                        'rounded-full transition-transform hover:scale-110',
                        c === color && 'ring-2 ring-(--ui-accent) ring-offset-1 ring-offset-(--ui-bg, transparent)'
                      ),
                      style: { width: 22, height: 22, backgroundColor: c },
                      onClick: () => onColor(c)
                    },
                    c
                  )
                )
              })
            ]
          })
        : null,

      tab === 'generate'
        ? imagen
          ? jsxs('div', {
              className: 'grid w-full gap-2',
              children: [
                jsx(Textarea, {
                  className: 'min-h-16 text-xs',
                  placeholder: 'Describe your avatar…',
                  value: describe,
                  onChange: event => setDescribe(event.target.value)
                }),
                jsxs(Button, {
                  type: 'button',
                  variant: 'secondary',
                  className: 'w-full justify-center',
                  disabled: genBusy,
                  onClick: generate,
                  children: [
                    genBusy
                      ? jsx(GlyphSpinner, {
                          spinner: 'breathe',
                          className: 'mr-1 text-[0.8rem]'
                        })
                      : jsx(Codicon, {
                          name: 'sparkle',
                          className: 'mr-1 text-[0.8rem]'
                        }),
                    genBusy ? 'Generating…' : 'Generate'
                  ]
                }),
                describe.trim()
                  ? null
                  : jsx('div', {
                      className: 'text-center text-[0.65rem] text-(--ui-text-quaternary)',
                      children: 'Leave blank to generate from the agent\u2019s name and description.'
                    })
              ]
            })
          : jsx('div', {
              className: 'px-2 py-3 text-center text-xs leading-5 text-(--ui-text-tertiary)',
              children:
                imagen === false
                  ? IMAGE_UNAVAILABLE_COPY
                  : 'Checking image backend…'
            })
        : null,

      tab === 'upload'
        ? jsxs(Button, {
            type: 'button',
            variant: 'secondary',
            className: 'w-full justify-center',
            onClick: upload,
            children: [
              jsx(Codicon, {
                name: 'device-camera',
                className: 'mr-1 text-[0.8rem]'
              }),
              'Choose an image…'
            ]
          })
        : null,

      tab === 'pet' ? jsx(PetTab, { image, onImage }) : null
    ]
  })
}

// ── pet tab: attach a petdex companion that lives beside the avatar ─────────

// A petdex "spritesheet" is the FULL animation sheet (1536×1872 webp, ~2MB;
// 8×9 grid of 192×208 frames). Using it as an <img> both downloads megabytes
// per tile and shows the whole sheet squashed. Extract frame 0 once per slug
// via canvas, downscale to 96px, and cache the data URL. Concurrency-capped
// so opening the tab doesn't fire dozens of 2MB fetches at once.
const PET_FRAME_W = 192
const PET_FRAME_H = 208
const petFrameCache = new Map()
let petFetchActive = 0
const petFetchQueue = []

function pumpPetQueue() {
  while (petFetchActive < 4 && petFetchQueue.length) {
    const job = petFetchQueue.shift()
    petFetchActive++
    job().finally(() => {
      petFetchActive--
      pumpPetQueue()
    })
  }
}

function petFrameIcon(spriteUrl) {
  if (!spriteUrl) {
    return Promise.resolve(null)
  }

  if (!petFrameCache.has(spriteUrl)) {
    petFrameCache.set(
      spriteUrl,
      new Promise(resolve => {
        petFetchQueue.push(async () => {
          try {
            const resp = await fetch(spriteUrl)
            const blob = await resp.blob()
            // Crop frame 0 during decode — never materialize the full sheet.
            const bitmap = await createImageBitmap(blob, 0, 0, PET_FRAME_W, PET_FRAME_H)
            const canvas = document.createElement('canvas')
            canvas.width = 96
            canvas.height = 104
            canvas.getContext('2d').drawImage(bitmap, 0, 0, 96, 104)
            bitmap.close()
            resolve(canvas.toDataURL('image/png'))
          } catch {
            resolve(null)
          }
        })
        pumpPetQueue()
      })
    )
  }

  return petFrameCache.get(spriteUrl)
}

/** One pet tile image: frame 0 only, resolved lazily through the cache. */
function PetThumb({ spriteUrl, size = 40 }) {
  const [icon, setIcon] = useState(null)

  useEffect(() => {
    let alive = true
    petFrameIcon(spriteUrl).then(url => {
      if (alive) {
        setIcon(url)
      }
    })
    return () => {
      alive = false
    }
  }, [spriteUrl])

  if (!icon) {
    return jsx('div', {
      style: {
        width: size,
        height: size,
        borderRadius: 6,
        background: 'var(--chrome-action-hover, rgba(255,255,255,0.06))'
      }
    })
  }

  return jsx('img', {
    src: icon,
    alt: '',
    style: {
      width: size,
      height: size,
      objectFit: 'contain',
      imageRendering: 'pixelated',
      borderRadius: 6
    }
  })
}

function PetTab({ image, onImage }) {
  // Selection is dialog-local: committed by the dialog's Save like any
  // uploaded/generated image (a direct meta write here gets clobbered by
  // Save's own image state).
  const [selectedSlug, setSelectedSlug] = useState(null)
  const { data, isLoading } = useQuery({
    queryKey: [ID, 'pet-gallery'],
    queryFn: () => host.request('pet.gallery', {}),
    staleTime: 300000
  })
  const [query, setQuery] = useState('')
  // Windowed rendering: the gallery is 4500+ pets — mounting an <img> per pet
  // froze the dialog. Render `limit` at a time and grow on scroll-to-bottom.
  const [limit, setLimit] = useState(24)
  const pets = data?.pets ?? []

  if (isLoading) {
    return jsx('div', {
      className: 'flex justify-center py-4',
      children: jsx(GlyphSpinner, {
        spinner: 'breathe',
        className: 'text-(--ui-text-tertiary)'
      })
    })
  }

  if (!pets.length) {
    return jsx('div', {
      className: 'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)',
      children: 'No pets in the petdex gallery. Run `hermes pets` to explore.'
    })
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? pets.filter(pet => (pet.displayName || '').toLowerCase().includes(q) || (pet.slug || '').includes(q))
    : pets
  // Installed and curated pets surface first — they're the likeliest picks.
  const ranked = filtered.slice().sort((a, b) => {
    const rank = pet => (pet.installed ? 0 : pet.curated ? 1 : 2)
    return rank(a) - rank(b)
  })
  const visible = ranked.slice(0, limit)

  const onScroll = event => {
    const el = event.currentTarget

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && limit < ranked.length) {
      setLimit(prev => Math.min(prev + 24, ranked.length))
    }
  }

  return jsxs('div', {
    className: 'grid w-full gap-2',
    children: [
      jsx('div', {
        className: 'text-center text-[0.65rem] text-(--ui-text-quaternary)',
        children: 'Pick a pet as this agent’s profile picture.'
      }),
      jsx(Input, {
        className: 'h-7 text-xs',
        placeholder: `Search ${pets.length} pets…`,
        value: query,
        onChange: event => {
          setQuery(event.target.value)
          setLimit(24)
        }
      }),
      image && selectedSlug
        ? jsx(Button, {
            type: 'button',
            variant: 'ghost',
            size: 'sm',
            className: 'justify-center',
            onClick: () => {
              setSelectedSlug(null)
              onImage(null)
            },
            children: 'Remove — back to shape avatar'
          })
        : null,
      filtered.length === 0
        ? jsx('div', {
            className: 'py-3 text-center text-xs text-(--ui-text-quaternary)',
            children: 'No pets match.'
          })
        : jsxs('div', {
            onScroll,
            style: { maxHeight: 220, overflowY: 'auto' },
            children: [
              jsx('div', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '6px'
                },
                children: visible.map(pet =>
                  jsxs(
                    'button',
                    {
                      type: 'button',
                      className: cn(
                        'grid justify-items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-(--chrome-action-hover)',
                        selectedSlug === pet.slug && 'ring-1 ring-(--ui-accent)'
                      ),
                      onClick: () => {
                        // The pet IS the profile picture: extract frame 0
                        // and hand it to the dialog as the avatar image.
                        // Persisted when the user hits Save.
                        setSelectedSlug(pet.slug)
                        void petFrameIcon(pet.spritesheetUrl).then(icon => {
                          if (icon) {
                            onImage(icon)
                          } else {
                            setSelectedSlug(null)
                            host.notify({
                              kind: 'error',
                              message: 'Could not load that pet — try another.'
                            })
                          }
                        })
                      },
                      children: [
                        jsx(PetThumb, {
                          spriteUrl: pet.spritesheetUrl,
                          size: 40
                        }),
                        jsx('span', {
                          className: 'w-full truncate text-center text-[0.6rem] text-(--ui-text-tertiary)',
                          children: pet.displayName
                        })
                      ]
                    },
                    pet.slug
                  )
                )
              }),
              limit < ranked.length
                ? jsx('div', {
                    className: 'py-2 text-center text-[0.65rem] text-(--ui-text-quaternary)',
                    children: `Scroll for more (${limit} of ${ranked.length})`
                  })
                : null
            ]
          })
    ]
  })
}

// ── data ─────────────────────────────────────────────────────────────────────

function useRoster() {
  return useQuery({
    queryKey: ROSTER_KEY,
    queryFn: () => host.request('profiles.list', {}),
    refetchInterval: 5000,
    staleTime: 5000,
    // Remote (SSH) gateways connect slowly and drop on sleep/wake; keep
    // retrying instead of latching a terminal error card.
    retry: true,
    retryDelay: attempt => Math.min(15000, 1000 * 2 ** attempt)
  })
}

/** The @handle users tag a bot with. The primary profile's callable alias
 *  is 'hermes' — the mention middleware resolves it back to 'default' — so
 *  the word 'default' never surfaces in the UI. */
function botHandle(name) {
  return (name || '').trim().toLowerCase() === 'default' ? 'hermes' : name
}

function showsHandle(name, meta) {
  const display = displayName({ name }, meta)
  return Boolean(name && display.toLowerCase() !== botHandle(name).toLowerCase())
}

// ── canonical bot chat ───────────────────────────────────────────────────────
// Each bot has ONE forever chat, pinned by stored-session id in bot meta
// (meta.chat — synced server-side via ui_meta, so it follows the profile).
// Opening a bot ALWAYS lands there: never "most recent session", which
// drifts whenever the profile is used from the CLI, Sessions mode, or a
// cronjob. The pin only changes through explicit adoption:
//   - grandfather: first open of a bot that already has history pins its
//     current latest session, so continuity starts from the chat in use
//   - fresh bot: opens a draft; when the first message persists a stored
//     session, we adopt that id (empty sessions are pruned server-side, so
//     pre-creating one at enable time is not possible)
//   - recovery: if the pinned id vanishes from the DB (compaction rewrote
//     the lineage), re-pin the newest session carrying the canonical title.

// In-flight creations, keyed by bot name — double-clicking a row must not
// mint two canonical chats.
const canonicalCreations = new Map()
let pinningCanonical = false
let lastMessengerBot = null
let botModeKeyGateInstalled = false
let pendingExplicitNewSession = null
let navigationIntentEpoch = 0
let navigationIntentTarget = ''
let sessionNavigationQueue = Promise.resolve()
let pluginDisposed = false

function claimNavigationIntent(target) {
  navigationIntentEpoch += 1
  navigationIntentTarget = target

  return { epoch: navigationIntentEpoch, target }
}

function isCurrentNavigationIntent(intent) {
  return Boolean(
    !pluginDisposed &&
      intent &&
      intent.epoch === navigationIntentEpoch &&
      intent.target === navigationIntentTarget
  )
}

/** openSession mutates shared router/profile state asynchronously. Serialize
 *  commits and check the latest click again when each reaches the front: an
 *  older navigation already in progress may finish, but the newest intent is
 *  guaranteed to run last and own the final visible chat. */
function queueSessionNavigation(storedId, profile, intent) {
  const run = sessionNavigationQueue
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrentNavigationIntent(intent) || typeof host.openSession !== 'function') {
        return false
      }

      try {
        await host.openSession(storedId, {
          profile,
          isCurrent: () => isCurrentNavigationIntent(intent)
        })
      } catch {
        return false
      }

      return isCurrentNavigationIntent(intent)
    })

  sessionNavigationQueue = run

  return run
}

function botsMessengerActive() {
  try {
    return Boolean(
      document.querySelector('div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]')
    )
  } catch {
    return false
  }
}

function routedStoredSessionId() {
  const hash = String(window.location.hash || '').replace(/^#/, '')
  const path = hash.split('?')[0]

  if (!path || path === '/') {
    return ''
  }

  if (
    path === '/settings' ||
    path.startsWith('/settings/') ||
    path.startsWith('/command-center') ||
    path.startsWith('/skills') ||
    path.startsWith('/cron') ||
    path.startsWith('/profiles') ||
    path.startsWith('/agents') ||
    path.startsWith('/messaging') ||
    path.startsWith('/artifacts') ||
    path.startsWith('/webhooks') ||
    path.startsWith('/starmap')
  ) {
    return null
  }

  const id = path.replace(/^\//, '')

  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

function isKnownGroupSession(storedId) {
  return Object.values($botGroups.get()).some(group => group.sessionId === storedId)
}

/** Map a session.info heartbeat onto the Bot Mode group it belongs to.
 *
 *  Group chats live as one coordinator session. Leaving mid-turn (or hitting
 *  auto-compression) often rotates the stored id or emits the coordinator's
 *  1:1 heartbeat first. Treating that as "not a group" used to clear the
 *  active group and snap the user onto that bot's empty Bot Chat. */
function resolveGroupSessionBinding({
  storedId,
  runtimeId,
  eventProfile,
  activeRuntime,
  groups,
  pendingGroupId,
  runtimeBoundGroupId,
  activeGroupId,
  navigationTarget,
  isDraft
}) {
  const roster = groups && typeof groups === 'object' ? groups : {}
  const found = Object.values(roster).find(item => item && item.sessionId === storedId)

  if (found) {
    return { action: 'bind', groupId: found.id, sessionId: storedId, clearPending: false }
  }

  // Same runtime, new stored id is compression — but only while THIS group is
  // still the foreground chat. Clicking a 1:1 on the coordinator profile
  // reuses that runtime and must not retarget the group onto Bot Chat.
  if (runtimeBoundGroupId && roster[runtimeBoundGroupId] && activeGroupId === runtimeBoundGroupId) {
    return { action: 'bind', groupId: runtimeBoundGroupId, sessionId: storedId, clearPending: false }
  }

  const pending = pendingGroupId ? roster[pendingGroupId] : null

  if (pending) {
    const profile = String(eventProfile || pending.profile || '').trim()

    if (profile === pending.profile && (!activeRuntime || activeRuntime === runtimeId)) {
      return { action: 'bind', groupId: pending.id, sessionId: storedId, clearPending: true }
    }
  }

  if (isDraft) {
    return { action: 'ignore' }
  }

  const openingGroup = String(navigationTarget || '').startsWith('group:')

  if (openingGroup || (activeGroupId && roster[activeGroupId])) {
    return { action: 'keep' }
  }

  if (activeRuntime === runtimeId) {
    return { action: 'clear' }
  }

  return { action: 'ignore' }
}

/** Bind the foreground 1:1 Bot Chat runtime to its durable stored id.
 *
 *  Compression keeps the runtime alive while rotating stored_session_id.
 *  Reconnect can also resume an old pin directly at its compression tip with a
 *  new runtime. Both are continuation handoffs, not new chats. */
function resolveCanonicalSessionBinding({
  storedId,
  runtimeId,
  eventProfile,
  eventTitle,
  activeRuntime,
  trackedRuntime,
  pinnedId,
  routedId,
  foregroundBot,
  activeGroupId,
  navigationTarget,
  isDraft,
  isExplicitNew
}) {
  if (
    !storedId ||
    !runtimeId ||
    !eventProfile ||
    activeRuntime !== runtimeId ||
    activeGroupId ||
    isDraft ||
    isExplicitNew ||
    String(navigationTarget || '').startsWith('group:') ||
    foregroundBot !== eventProfile
  ) {
    return { action: 'ignore' }
  }

  if (storedId === pinnedId) {
    return { action: 'track', profile: eventProfile, sessionId: storedId }
  }

  const isCanonicalContinuation =
    eventTitle === CANONICAL_CHAT_TITLE &&
    Boolean(pinnedId) &&
    (trackedRuntime === runtimeId || routedId === storedId)

  if (isCanonicalContinuation) {
    return { action: 'advance', profile: eventProfile, sessionId: storedId }
  }

  return { action: 'ignore' }
}

/** Prefer the pinned Bot Chat; never the most-recent session, which is how
 *  extra tabs used to steal the open transcript. When the pin was demoted to
 *  "Previous Bot Chat" by /new, follow the replacement canonical title. */
function pickCanonicalSessionId(rows, pinnedId) {
  const list = Array.isArray(rows) ? rows : []
  const pinned = pinnedId ? list.find(session => session.id === pinnedId) : null
  const pinnedTitle = String(pinned?.title || '')

  if (pinned && pinnedTitle !== 'Previous Bot Chat' && pinnedTitle !== 'Previous group chat') {
    return pinnedId
  }

  const titled = list.filter(session => String(session.title || '') === 'Bot Chat')

  if (titled.length > 0) {
    titled.sort((left, right) => {
      const leftAt = Number(left.updated_at || left.last_active || 0)
      const rightAt = Number(right.updated_at || right.last_active || 0)

      return rightAt - leftAt
    })

    return titled[0]?.id || null
  }

  return pinned?.id || null
}

function sessionCreateParamsForBot(name, fallbackBot = null) {
  const bot = botFromRoster(name)
  const params = {
    profile: name,
    title: CANONICAL_CHAT_TITLE
  }
  const model = String(bot.model || fallbackBot?.model || '').trim()
  const provider = String(bot.provider || fallbackBot?.provider || '').trim()

  if (model && provider) {
    params.model = model
    params.provider = provider
  }

  return params
}

function seedBotComposerModel(name, fallbackBot = null) {
  const bot = botFromRoster(name)
  const model = String(bot.model || fallbackBot?.model || '').trim()
  const provider = String(bot.provider || fallbackBot?.provider || '').trim()

  if (model && provider && typeof host.seedComposerSelection === 'function') {
    host.seedComposerSelection({ model, provider })
  }
}

function snapToCanonicalIfStray() {
  if (
    pinningCanonical ||
    pendingExplicitNewSession ||
    $activeGroupId.get() ||
    String(navigationIntentTarget || '').startsWith('group:')
  ) {
    return
  }

  const draft = $newConversation.get()

  // Recipient selection owns navigation while a draft is open, including the
  // zero/one-recipient stages. Snap-back here used to steal the draft intent.
  if (draft) {
    return
  }

  if (!botsMessengerActive()) {
    return
  }

  const stored = routedStoredSessionId()

  if (stored === null) {
    return
  }

  if (stored && isKnownGroupSession(stored)) {
    return
  }

  const name = (draft?.participantIds?.[0] || lastMessengerBot || $selectedBot.get() || host.state.profile.get() || '').trim()

  if (!name) {
    return
  }

  const pin = $botMeta.get()[name]?.chat

  if (pin && stored === pin) {
    return
  }

  const target = `bot:${name}`

  // Core follows a compression continuation by changing only the routed
  // stored id; the runtime remains the same. Advance the durable bot pin
  // instead of fighting core and reopening the archived pre-compression id.
  const activeRuntime = host.state.activeSessionId?.get?.()
  const activeProfile = String(host.state.profile.get() || '').trim()

  if (
    pin &&
    stored &&
    stored !== pin &&
    activeRuntime &&
    activeProfile === name &&
    liveBotRuntimes.get(name) === activeRuntime
  ) {
    saveBotMeta(name, { chat: stored })
    return
  }

  const intent =
    navigationIntentTarget === target
      ? { epoch: navigationIntentEpoch, target }
      : claimNavigationIntent(target)

  pinningCanonical = true
  void openBotChat(botFromRoster(name), {
    intent,
    preserveDraft: Boolean(draft),
    quiet: true
  }).finally(() => {
    pinningCanonical = false
  })
}

const BOT_MODE_BLOCKED_ACTION_RE =
  /^(?:profile\.switch\.\d+|session\.slot\.\d+|session\.(?:newTab|next|prev))$/

/** Core asks before running a keybind. Claim hidden-tab/profile navigation
 *  while Bot Mode is visible, before it mutates the layout — no snap-back. */
function onBotModeKeybindBeforeRun(event) {
  const actionId = String(event?.detail?.actionId || '')

  if (botsMessengerActive() && BOT_MODE_BLOCKED_ACTION_RE.test(actionId)) {
    event.preventDefault()
  }
}

/** /new is an explicit conversation boundary, unlike Cmd+digit navigation.
 *  Let core open a fresh draft and remember which bot/group should adopt the
 *  stored session created by the user's first message. */
function onBotModeNewSessionRequested(event) {
  if (event?.detail?.source !== 'slash' || !botsMessengerActive()) {
    return
  }

  const activeGroupId = $activeGroupId.get()
  const group = activeGroupId ? $botGroups.get()[activeGroupId] : null
  const name = String(group?.profile || lastMessengerBot || $selectedBot.get() || host.state.profile.get() || '').trim()

  if (!name) {
    return
  }

  pendingExplicitNewSession = {
    groupId: group?.id || null,
    name,
    previousChat: group?.sessionId || $botMeta.get()[name]?.chat || null,
    previousRuntime: host.state.activeSessionId?.get?.() || null
  }
  claimNavigationIntent(`new:${group?.id || name}`)
  lastMessengerBot = name
  seedBotComposerModel(name)

  if (typeof host.newChat === 'function') {
    host.newChat(name)
  }
}

function attachBotModeKeyGate() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }

  if (!botModeKeyGateInstalled) {
    if (botsMessengerActive()) {
      const profile = String(host.state.profile.get() || '').trim()
      lastMessengerBot = profile || lastMessengerBot
    }

    window.addEventListener('hermes:keybind-before-run', onBotModeKeybindBeforeRun)
    window.addEventListener('hermes:new-session-requested', onBotModeNewSessionRequested)
    botModeKeyGateInstalled = true
  }
}

function detachBotModeKeyGate() {
  if (typeof window !== 'undefined' && botModeKeyGateInstalled) {
    window.removeEventListener('hermes:keybind-before-run', onBotModeKeybindBeforeRun)
    window.removeEventListener('hermes:new-session-requested', onBotModeNewSessionRequested)
  }

  botModeKeyGateInstalled = false
}

/** Create the bot's ONE forever chat: a real session opened with a kickoff
 *  message (the gateway prunes zero-message sessions, so the chat is born
 *  with the bot introducing itself). Pins the stored id in bot meta and
 *  returns it. */
function createCanonicalChat(name, options = {}) {
  const shouldOpen = options.open !== false
  const inflight = canonicalCreations.get(name)

  if (inflight) {
    return inflight
  }

  const run = (async () => {
    const res = await host.request('session.create', sessionCreateParamsForBot(name, options.bot))
    const sid = res?.stored_session_id
    const runtime = res?.session_id

    if (runtime) {
      liveBotRuntimes.set(name, runtime)
    }

    // Delete raced this create: drop the live handle so it cannot mkdir
    // the profile directory back into the roster.
    if (isRecentlyDeleted(name)) {
      if (runtime) {
        await host.request('session.close', { session_id: runtime }).catch(() => undefined)
        liveBotRuntimes.delete(name)
      }

      return null
    }

    if (sid) {
      saveBotMeta(name, { chat: sid })
    }

    // Mount the session view FIRST, then send the kickoff — submitting into
    // an unmounted session left the intro reply invisible until reopen.
    if (shouldOpen && sid && typeof host.openSession === 'function') {
      try {
        await host.openSession(sid, { profile: name })
      } catch {
        // Navigation failure doesn't block the kickoff.
      }
    }

    if (runtime) {
      const timer = window.setTimeout(() => {
        canonicalKickoffs.delete(name)
        if (isRecentlyDeleted(name)) {
          void host.request('session.close', { session_id: runtime }).catch(() => undefined)
          return
        }

        void host
          .request('prompt.submit', {
            session_id: runtime,
            text: 'Hey, tell me about yourself!'
          })
          .catch(() => undefined)
      }, 400)
      canonicalKickoffs.set(name, timer)
    }

    return sid || null
  })().finally(() => canonicalCreations.delete(name))

  canonicalCreations.set(name, run)

  return run
}

function displayName(bot, meta) {
  if (meta?.title?.trim()) {
    return meta.title.trim()
  }

  // The primary profile is literally named "default" — as a bot identity
  // that reads like nobody bothered. Present it as Hermes (the agent it is)
  // unless the user gives it a real title.
  if ((bot.name || '').trim().toLowerCase() === 'default' && !bot.title) {
    return 'Hermes'
  }

  const raw = (bot.title || bot.name || '').replace(/[-_]+/g, ' ').trim()
  return raw.replace(/\b\w/g, ch => ch.toUpperCase())
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** The agent-to-agent messaging protocol, reusable so a CUSTOM SOUL keeps
 *  the handoff protocol too — a custom SOUL used to silently drop it,
 *  breaking @mentions for customized bots (@wesleysimplicio, #16). */
function messagingProtocolSection(name, roster) {
  const teammates = (roster || []).filter(b => b.name !== name)

  return [
    '## Messaging other agents',
    '',
    'You work alongside other named agents. Every agent (including you) has',
    'ONE canonical conversation titled "Bot Chat" — created with the agent,',
    'so it always exists. Agent-to-agent messages are delivered straight',
    'into it, like a DM. To message a teammate, run:',
    '',
    '```',
    'hermes -p <agent-name> chat -c "Bot Chat" -Q -q "Message from \uD83E\uDD16 ' +
      name +
      ' (@' +
      name +
      '): your message"',
    '```',
    '',
    '(`-c "Bot Chat"` resumes their canonical conversation and restores its',
    'workspace. `-Q` keeps output clean. Always open with the',
    '"Message from \uD83E\uDD16 ' + name + ' (@' + name + '):" prefix so they know',
    'who is talking (the @handle lets the app show your avatar to them).',
    'Their reply prints to stdout — relay the relevant part back to the',
    'user, and say which agent it came from. In the rare case the target',
    'has no "Bot Chat" yet, send once WITHOUT -c, then',
    '`hermes -p <agent-name> sessions rename <session-id> "Bot Chat"`.)',
    '',
    'If a message in YOUR chat starts with "Message from \uD83E\uDD16 <name>", it is',
    'a teammate messaging you, not the user. Answer it directly — your reply',
    'reaches them via their own delivery — and use the same command if you',
    'need to start a conversation yourself.',
    '',
    'When the user writes @<agent-name> or says "ask <name> to ..." /',
    '"tell <name> ...", that is a handoff: message that agent, wait for the',
    'reply, and report back.',
    '',
    'The roster grows over time — run `hermes profile list` for the LIVE',
    'teammate list before a handoff. Teammates when you were created:',
    ...(teammates.length
      ? teammates.map(b => `- \`${b.name}\`${b.description ? ` — ${b.description}` : ''}`)
      : ['- (none yet)'])
  ].join('\n')
}

/** SOUL.md for a new bot: identity (or the user's custom SOUL) + the
 *  messaging protocol, which ALWAYS ships. */
function composeSoul({ name, title, description, roster, customSoul }) {
  if (customSoul && customSoul.trim()) {
    return customSoul.trim() + '\n\n' + messagingProtocolSection(name, roster)
  }

  const lines = [
    `# ${displayName({ name, title })}`,
    '',
    title ? `**Role:** ${title}` : null,
    description ? `**Mission:** ${description}` : null,
    '',
    `You are ${displayName({ name, title })}, a persistent named agent (profile \`${name}\`) on this machine.`,
    'You keep your own memory, skills, and conversation history across sessions.'
  ]

  return lines.filter(line => line !== null).join('\n') + '\n\n' + messagingProtocolSection(name, roster)
}

function botFromRoster(name, roster = $lastRoster.get()) {
  return roster.find(bot => bot.name === name) || { name, description: '' }
}

function participantLabel(name, roster = $lastRoster.get()) {
  const bot = botFromRoster(name, roster)

  return displayName(bot, $botMeta.get()[name])
}

function groupTitle(participantIds, roster = $lastRoster.get()) {
  return participantIds.map(name => participantLabel(name, roster)).join(', ')
}

/** Remote clocks can be a few seconds ahead of the desktop. A conversation
 * row must never claim that a message arrives "in 25 sec." */
function conversationTime(timestamp) {
  return relativeTime(Math.min(Date.now(), Number(timestamp) || 0))
}

function uniqueProfileName(wanted, roster) {
  const base = slugify(wanted) || 'new-bot'
  const names = new Set((roster || []).map(bot => bot.name))
  for (const name of Object.keys(deletedBots)) {
    names.add(name)
  }

  if (!names.has(base)) {
    return base
  }

  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`
    const candidate = base.slice(0, 64 - suffix.length) + suffix

    if (!names.has(candidate)) {
      return candidate
    }
  }

  return `new-bot-${Date.now().toString(36)}`.slice(0, 64)
}

async function createQuickBot(wantedTitle, roster, launchProvider, launchModel) {
  const title = String(wantedTitle || '').trim()
  const name = uniqueProfileName(title || 'new-bot', roster)
  const modelAssignment = resolveCreateAgentModel('', '', launchProvider, launchModel)

  await host.request('profiles.create', {
    name,
    description: title && slugify(title) !== name ? title : '',
    clone_from: null,
    no_skills: false,
    soul: composeSoul({ name, title, description: '', roster, customSoul: '' }),
    ...modelAssignment
  })
  clearDeletedBotTombstone(name)

  saveBotMeta(name, {
    color: AVATAR_COLORS[Math.abs(name.length * 7) % AVATAR_COLORS.length],
    created: Date.now(),
    shape: 'circle',
    title
  })
  queryClient.invalidateQueries({ queryKey: ROSTER_KEY })

  // Give every quick-created bot the same canonical-chat invariant as a bot
  // made in the detailed editor, but don't navigate away from the recipient
  // picker while the user is assembling a group.
  try {
    await createCanonicalChat(name, {
      bot: { name, title, ...modelAssignment },
      open: false
    })
  } catch {
    // The profile still exists; its first direct open will recover the chat.
  }

  syncConnectorsForRoster([...(roster || []), { name }], { force: true })
  return { name, description: '', title, ...modelAssignment }
}

async function openBotChat(bot, { intent: suppliedIntent = null, preserveDraft = false, quiet = false } = {}) {
  const target = `bot:${bot.name}`
  const intent =
    suppliedIntent?.target === target
      ? suppliedIntent
      : claimNavigationIntent(target)

  if (!isCurrentNavigationIntent(intent)) {
    return
  }

  if (!quiet) {
    haptic('tap')
  }

  // Quiet navigation still changes the foreground bot (recipient selection,
  // canonical recovery, first-run landing). Keep the navigation anchor current
  // or a later hash/profile heartbeat can snap back to the previous bot.
  lastMessengerBot = bot.name
  seedBotComposerModel(bot.name, bot)

  forgetGroupRuntimes($activeGroupId.get())
  $activeGroupId.set(null)

  if (!preserveDraft) {
    $newConversation.set(null)
  }

  $selectedBot.set(bot.name)

  if ($botUnread.get()[bot.name]) {
    const nextUnread = { ...$botUnread.get() }
    delete nextUnread[bot.name]
    $botUnread.set(nextUnread)
  }

  const meta = $botMeta.get()[bot.name]
  let id = meta?.chat

  try {
    const res = await host.request('session.list', {
      profile: bot.name,
      limit: 100
    })

    if (!isCurrentNavigationIntent(intent)) {
      return
    }

    id = pickCanonicalSessionId(res?.sessions ?? [], id)

    if (id && id !== meta?.chat) {
      saveBotMeta(bot.name, { chat: id })
    }
  } catch {
    // Gateway hiccup — try the pin as-is.
  }

  if (!isCurrentNavigationIntent(intent)) {
    return
  }

  if (!id) {
    try {
      id = await createCanonicalChat(bot.name, { bot, open: false })

      if (!id || !isCurrentNavigationIntent(intent)) {
        return
      }
    } catch {
      return
    }
  }

  await queueSessionNavigation(id, bot.name, intent)
}

function onFirstBotProfile(event) {
  const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {}
  const name = String(detail.name || '').trim()

  if (!NAME_RE.test(name)) {
    return
  }

  pinBotFirst(name)
  queryClient.invalidateQueries({ queryKey: ROSTER_KEY })

  if (!detail.open) {
    return
  }

  // Claim before the profile refresh. If the user clicks a different bot while
  // that request is in flight, their newer intent wins and this first-run
  // landing is discarded instead of auto-switching them back.
  const intent = claimNavigationIntent(`bot:${name}`)

  void (async () => {
    let bot = {
      name,
      title: name,
      model: String(detail.model || '').trim(),
      provider: String(detail.provider || '').trim()
    }

    try {
      const response = await host.request('profiles.list', {})
      const current = (response?.profiles || []).find(profile => profile.name === name)

      if (current) {
        bot = { ...bot, ...current }
      }
    } catch {
      // The freshly-created profile may not be visible to a reconnecting
      // gateway yet. Its setup payload still carries the exact model pin.
    }

    if (!pluginDisposed) {
      await openBotChat(bot, { intent })
    }
  })()
}

function beginNewConversation() {
  haptic('tap')
  const originGroupId = $activeGroupId.get()
  const originBotName = $selectedBot.get()
  const draftId = `group-${Date.now().toString(36)}`

  claimNavigationIntent(`draft:${draftId}`)

  $activeGroupId.set(null)
  $newConversation.set({
    id: draftId,
    participantIds: [],
    createdAt: Date.now(),
    origin: {
      botName: originBotName,
      groupId: originGroupId
    }
  })

  // Stay on this bot's one thread while the recipient picker owns navigation. A
  // fresh session is created only when the draft becomes a real group.
}

async function closeNewConversation() {
  const draft = $newConversation.get()
  const origin = draft?.origin

  $newConversation.set(null)
  $activeGroupId.set(null)

  const group = origin?.groupId ? $botGroups.get()[origin.groupId] : null

  if (group) {
    await openBotGroup(group)

    return
  }

  if (origin?.botName) {
    await openBotChat(botFromRoster(origin.botName))
  }
}

async function resolveOpenableGroupSessionId(group, intent) {
  const pin = $botMeta.get()[group.profile]?.chat || null
  let id = group.sessionId && group.sessionId !== pin ? group.sessionId : null

  try {
    const res = await host.request('session.list', {
      profile: group.profile,
      limit: 100
    })

    if (!isCurrentNavigationIntent(intent)) {
      return null
    }

    const rows = Array.isArray(res?.sessions) ? res.sessions : []

    if (id && rows.some(session => session.id === id)) {
      return id
    }

    const titled = rows.find(session => String(session.title || '') === group.title && session.id !== pin)

    if (titled?.id) {
      patchBotGroup(group.id, { sessionId: titled.id, lastActive: Date.now() })

      return titled.id
    }
  } catch {
    if (id) {
      return id
    }
  }

  return id
}

async function openBotGroup(group) {
  const target = `group:${group.id}`
  const intent = claimNavigationIntent(target)

  $newConversation.set(null)
  $activeGroupId.set(group.id)
  $selectedBot.set(group.profile)
  lastMessengerBot = group.profile

  const sessionId = await resolveOpenableGroupSessionId(group, intent)

  if (!isCurrentNavigationIntent(intent)) {
    return
  }

  if (sessionId && typeof host.openSession === 'function') {
    await queueSessionNavigation(sessionId, group.profile, intent)
  } else if (isCurrentNavigationIntent(intent) && typeof host.newChat === 'function') {
    host.newChat(group.profile)
  }
}

function createOrActivateDraftGroup(draft, roster) {
  const existing = $botGroups.get()[draft.id]

  if (existing) {
    $activeGroupId.set(existing.id)
    $newConversation.set(null)

    return existing
  }

  const group = {
    id: draft.id,
    participantIds: draft.participantIds.slice(),
    profile: draft.participantIds[0],
    sessionId: null,
    title: groupTitle(draft.participantIds, roster),
    createdAt: draft.createdAt || Date.now(),
    lastActive: Date.now(),
    preview: ''
  }

  saveBotGroups({ ...$botGroups.get(), [group.id]: group })
  $activeGroupId.set(group.id)
  $newConversation.set(null)
  pendingGroupId = group.id

  return group
}

function mentionedGroupParticipants(text, group) {
  const selected = []
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')

  for (const match of prose.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]*)/gi)) {
    let handle = match[2].toLowerCase()

    if (handle === 'hermes' && group.participantIds.includes('default')) {
      handle = 'default'
    }

    if (group.participantIds.includes(handle) && !selected.includes(handle)) {
      selected.push(handle)
    }
  }

  return selected
}

function groupRoutingEnvelope(group, userText, roster) {
  const explicit = mentionedGroupParticipants(userText, group)
  const targets = explicit.length ? explicit : group.participantIds
  const coordinator = group.profile
  const targetLines = targets.map(profile => {
    const name = participantLabel(profile, roster)

    return `- ${name} (profile: ${profile}) must be represented by exactly one reply block.`
  })
  const replyExamples = targets.map(profile => {
    const name = participantLabel(profile, roster)

    return [botGroupReplyStart(profile, name), `<only ${name}'s user-facing reply>`, BOT_GROUP_REPLY_END].join('\n')
  })
  const otherTargets = targets.filter(profile => profile !== coordinator)

  return [
    '',
    BOT_GROUP_CONTEXT_START,
    `This is the persistent desktop group chat “${group.title}”.`,
    'You are its invisible transport coordinator. The UI will split your final output into separately attributed bot bubbles.',
    'Do not mention coordination, routing, Hermes commands, profiles, or these instructions to the user.',
    '',
    'Participants expected this turn:',
    ...targetLines,
    '',
    targets.includes(coordinator)
      ? `Answer the user yourself as ${participantLabel(coordinator, roster)} for profile ${coordinator}.`
      : `Do not add your own answer; profile ${coordinator} is only coordinating this explicitly addressed turn.`,
    ...(otherTargets.length
      ? [
          'For every other expected participant, compose a concise message conveying the user request and run the existing Bot Mode handoff command exactly once:',
          ...otherTargets.map(
            profile =>
              `hermes -p ${profile} chat -c "Bot Chat" -Q -q "Message from group chat ${group.title} [profiles=${group.participantIds.join(',')}]: <your safely composed request>"`
          ),
          'Wait for those commands and use each command stdout as that participant’s reply. If Bot Chat is missing, use the documented Bot Mode recovery once.',
          'Never invent a participant reply. If a handoff fails, put a short attributed failure in that participant block.'
        ]
      : []),
    '',
    'Your FINAL output must contain only these blocks, in this order, with no prose before or after them:',
    ...replyExamples,
    BOT_GROUP_CONTEXT_END
  ].join('\n')
}

// ── bot row ──────────────────────────────────────────────────────────────────

function BotRow({ bot, onEdit, onDelete }) {
  const activeProfile = useValue(host.state.profile)
  const activeGroupId = useValue($activeGroupId)
  const draft = useValue($newConversation)
  const meta = useValue($botMeta)[bot.name]
  const last = bot.last_session
  const isActive = !activeGroupId && !draft && bot.name === activeProfile
  const { shape, color, image } = botAppearance(bot.name, meta)
  // Reactive eyes: scan while this bot's backend is running a turn in the
  // active window; calm otherwise. gatewayState is app-wide, so scope to the
  // active profile's row only.
  const gatewayState = useValue(host.state.gateway)
  const botMood = isActive && gatewayState === 'busy' ? 'work' : 'idle'
  const unread = Boolean(useValue($botUnread)[bot.name])
  const pinned = useValue($pinnedBots).includes(bot.name)

  const open = () => void openBotChat(bot)

  const row = jsxs('button', {
    type: 'button',
    draggable: true,
    onDragStart: event => startBotDrag(event, bot.name),
    onDragEnd: finishBotDrag,
    onClick: open,
    className: cn(
      'flex w-full items-center gap-2.5 rounded-2xl border border-transparent px-2 py-2 text-left transition-colors',
      'hover:bg-(--chrome-action-hover)',
      isActive && 'border-(--ui-stroke-secondary) bg-(--ui-control-active-background)'
    ),
    style: { borderRadius: '18px' },
    children: [
      jsx('div', {
        className: 'shrink-0',
        children: jsx(BotFace, {
          shape,
          color,
          image,
          size: 34,
          name: bot.name,
          mood: botMood
        })
      }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-baseline justify-between gap-2',
            children: [
              jsxs('div', {
                className: 'flex min-w-0 items-baseline gap-1.5 truncate',
                children: [
                  jsx('span', {
                    className: 'truncate text-[0.8125rem] font-medium',
                    children: displayName(bot, meta)
                  }),
                  null
                ]
              }),
              unread
                ? jsx('span', {
                    className: 'size-2 shrink-0 rounded-full bg-(--ui-accent,#4f9cf9)',
                    'aria-label': 'unread'
                  })
                : null,
              last
                ? jsx('span', {
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: conversationTime(last.last_active * 1000)
                  })
                : null
            ]
          }),
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-tertiary)',
            children: last?.preview || bot.description || 'No conversations yet — say hi'
          })
        ]
      })
    ]
  })

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children: row }),
      jsxs(ContextMenuContent, {
        children: [
          jsx(ContextMenuItem, {
            onSelect: () => toggleBotPin(bot.name),
            children: pinned ? 'Unpin from top' : 'Pin to top'
          }),
          jsx(ContextMenuItem, {
            onSelect: () => onEdit(bot),
            children: 'Edit Profile'
          }),
          jsx(ContextMenuItem, {
            onSelect: () => {
              host.notify({
                kind: 'info',
                message: `Duplicating ${displayName(bot, meta)}…`
              })
              duplicateBot(bot, $lastRoster.get())
                .then(name => {
                  queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
                  host.notify({
                    kind: 'success',
                    message: `Created ${name} — full copy of ${bot.name}`
                  })
                })
                .catch(err => host.notifyError(err, 'Duplicate failed'))
            },
            children: 'Duplicate'
          }),
          ...deleteMenuItems(bot, onDelete)
        ]
      })
    ]
  })
}

// ── model picker (provider/model dropdowns via model.options) ───────────────

function useModelOptions() {
  return useQuery({
    queryKey: [ID, 'model-options'],
    queryFn: () => host.request('model.options', {}),
    staleTime: 120000,
    retry: false
  })
}

/**
 * Provider + model dropdowns from the gateway's configured inventory — the
 * same data the core model picker shows. `value = {provider, model}`;
 * onChange receives the merged patch. Older gateways (no model.options)
 * degrade to the previous free-text inputs.
 */
function ModelPicker({ value, onChange, placeholderModel = 'gateway default' }) {
  const { data, error, isFetching, isLoading, refetch } = useModelOptions()

  if (isLoading) {
    return jsx('div', {
      className: 'flex justify-center py-2',
      children: jsx(GlyphSpinner, {
        spinner: 'breathe',
        className: 'text-(--ui-text-tertiary)'
      })
    })
  }

  const providers = (data?.providers || []).filter(p => (p.models || []).length)

  // No free-text fallback here. Two text inputs looked like a graceful
  // degradation and behaved like a trap: a typo pinned a bot to a provider
  // that does not exist, and the failure surfaced much later as a runtime
  // error far from the field that caused it. Say what broke, offer a retry.
  if (error || !providers.length) {
    return jsxs('div', {
      className: 'rounded-lg border border-(--ui-stroke-secondary) px-3 py-2.5',
      children: [
        jsx('div', {
          className: 'text-xs font-medium',
          children: error ? 'Could not read the model inventory' : 'No models available'
        }),
        jsx('div', {
          className: 'mt-1 text-[0.6875rem] text-(--ui-text-tertiary)',
          children: error
            ? 'The gateway did not answer. This bot keeps the model it already has.'
            : 'No provider on this gateway has an authenticated credential yet.'
        }),
        jsxs('div', {
          className: 'mt-2 flex items-center gap-2',
          children: [
            jsx(Button, {
              size: 'sm',
              variant: 'secondary',
              disabled: isFetching,
              onClick: () => void refetch(),
              children: isFetching ? 'Checking…' : 'Retry'
            }),
            value.model
              ? jsx('span', {
                  className: 'truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                  children: `Currently ${value.model}`
                })
              : null
          ]
        })
      ]
    })
  }

  const NONE = '__default__'
  const activeProvider = providers.find(p => p.slug === value.provider) || null
  const models = activeProvider ? (activeProvider.models || []).map(m => (typeof m === 'string' ? m : m.id)) : []

  return jsxs('div', {
    style: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '10px' },
    children: [
      labeled(
        'Provider',
        jsxs(Select, {
          value: value.provider || NONE,
          onValueChange: v => {
            if (v === NONE) {
              onChange({ provider: '', model: '' })
            } else {
              const prov = providers.find(p => p.slug === v)
              const first = prov?.models?.[0]
              onChange({
                provider: v,
                // Keep the model if it exists under the new provider,
                // otherwise preselect that provider's first model.
                model:
                  prov && (prov.models || []).some(m => (typeof m === 'string' ? m : m.id) === value.model)
                    ? value.model
                    : typeof first === 'string'
                      ? first
                      : first?.id || ''
              })
            }
          },
          children: [
            jsx(SelectTrigger, {
              className: 'h-8 rounded-lg',
              children: jsx(SelectValue, {})
            }),
            jsxs(SelectContent, {
              children: [
                jsx(SelectItem, {
                  value: NONE,
                  children: 'Inherit (launch profile)'
                }),
                // Rows read as products, not config keys: the gateway's display
                // name over the raw slug, the brand mark where one exists, and
                // a disabled row for a provider with no live credential.
                ...providers.map(p => {
                  const choice = providerChoiceFor(p.slug)
                  const disconnected = p.authenticated === false

                  return jsx(
                    SelectItem,
                    {
                      value: p.slug,
                      disabled: disconnected,
                      children: jsxs('span', {
                        className: 'flex items-center gap-1.5',
                        children: [
                          choice ? jsx(ProviderMark, { id: choice.id, size: 12 }) : null,
                          jsx('span', { className: 'truncate', children: p.name || p.slug }),
                          disconnected
                            ? jsx('span', {
                                className: 'text-[0.65rem] text-(--ui-text-quaternary)',
                                children: 'not connected'
                              })
                            : null
                        ]
                      })
                    },
                    p.slug
                  )
                })
              ]
            })
          ]
        })
      ),
      labeled(
        'Model',
        activeProvider
          ? jsxs(Select, {
              value: value.model || (models[0] ?? ''),
              onValueChange: v => onChange({ model: v }),
              children: [
                jsx(SelectTrigger, {
                  className: 'h-8 rounded-lg',
                  children: jsx(SelectValue, {})
                }),
                jsx(SelectContent, {
                  children: models.map(m => jsx(SelectItem, { value: m, children: m }, m))
                })
              ]
            })
          : jsx(Input, {
              disabled: true,
              placeholder: placeholderModel,
              value: '',
              onChange: () => undefined
            })
      )
    ]
  })
}

// ── advanced profile config (skills / toolsets / model / SOUL) ──────────────
//
// Shared by Edit Profile and New Agent (edit mode only for skills/toolsets —
// a not-yet-created profile has nothing installed to toggle). Backed by
// profiles.describe / profiles.configure; feature-detects older gateways.

function CheckList({ items, onToggle, columns = 2 }) {
  return jsx('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: '2px 12px'
    },
    children: items.map(item =>
      jsxs(
        'label',
        {
          className: 'flex min-w-0 cursor-pointer items-center gap-1.5 py-0.5 text-xs text-(--ui-text-secondary)',
          title: item.description || item.name,
          children: [
            jsx(Checkbox, {
              checked: item.enabled,
              onCheckedChange: value => onToggle(item.name, Boolean(value))
            }),
            jsx('span', { className: 'truncate', children: item.name }),
            item.tool_count
              ? jsx('span', {
                  className: 'shrink-0 text-[0.6rem] text-(--ui-text-quaternary)',
                  children: `${item.tool_count}`
                })
              : null
          ]
        },
        item.name
      )
    )
  })
}

function AdvancedProfileConfig({ bot, state, setState }) {
  const [loaded, setLoaded] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')

  if (!loaded) {
    setLoaded(true)
    host
      .request('profiles.describe', { name: bot })
      .then(res => {
        setState(prev => ({
          ...prev,
          provider: res.model?.provider || '',
          model: res.model?.default || '',
          soul: res.soul || '',
          skills: res.skills || [],
          toolsets: res.toolsets || [],
          loaded: true
        }))
      })
      .catch(() => setUnsupported(true))
  }

  if (unsupported) {
    return jsx('div', {
      className: 'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)',
      children: 'Full configuration needs a newer gateway (restart it after updating Hermes).'
    })
  }

  if (!state.loaded) {
    return jsx('div', {
      className: 'flex justify-center py-4',
      children: jsx(GlyphSpinner, {
        spinner: 'breathe',
        className: 'text-(--ui-text-tertiary)'
      })
    })
  }

  const visibleSkills = skillFilter.trim()
    ? state.skills.filter(s => s.name.toLowerCase().includes(skillFilter.trim().toLowerCase()))
    : state.skills

  const toggleSkill = (name, enabled) =>
    setState(prev => ({
      ...prev,
      dirtySkills: true,
      skills: prev.skills.map(s => (s.name === name ? { ...s, enabled } : s))
    }))

  const toggleToolset = (name, enabled) =>
    setState(prev => ({
      ...prev,
      dirtyToolsets: true,
      toolsets: prev.toolsets.map(t => (t.name === name ? { ...t, enabled } : t))
    }))

  const enabledSkills = state.skills.filter(s => s.enabled).length
  const enabledToolsets = state.toolsets.filter(t => t.enabled).length

  return jsxs('div', {
    className: 'grid gap-4',
    children: [
      jsx(ModelPicker, {
        value: { provider: state.provider, model: state.model },
        onChange: patch => setState(prev => ({ ...prev, dirtyModel: true, ...patch }))
      }),
      labeled(
        `Skills (${enabledSkills}/${state.skills.length} enabled)`,
        jsxs('div', {
          className: 'grid gap-1.5 rounded-xl border border-(--ui-stroke-secondary) p-2',
          children: [
            jsx(Input, {
              className: 'h-7 text-xs',
              placeholder: 'Filter skills…',
              value: skillFilter,
              onChange: event => setSkillFilter(event.target.value)
            }),
            jsx(ScrollArea, {
              style: { maxHeight: 180 },
              children: jsx(CheckList, {
                items: visibleSkills,
                onToggle: toggleSkill,
                columns: 2
              })
            })
          ]
        })
      ),
      labeled(
        `Toolsets (${enabledToolsets}/${state.toolsets.length} enabled — unchecking all restores the default)`,
        jsx('div', {
          className: 'rounded-xl border border-(--ui-stroke-secondary) p-2',
          children: jsx(ScrollArea, {
            style: { maxHeight: 160 },
            children: jsx(CheckList, {
              items: state.toolsets,
              onToggle: toggleToolset,
              columns: 2
            })
          })
        })
      ),
      labeled(
        'SOUL.md (persona + agent-messaging protocol)',
        jsx(Textarea, {
          className: 'min-h-28 font-mono text-xs leading-5',
          value: state.soul,
          onChange: event =>
            setState(prev => ({
              ...prev,
              dirtySoul: true,
              soul: event.target.value
            }))
        })
      )
    ]
  })
}

function emptyAdvancedState() {
  return {
    loaded: false,
    provider: '',
    model: '',
    soul: '',
    skills: [],
    toolsets: [],
    dirtyModel: false,
    dirtySoul: false,
    dirtySkills: false,
    dirtyToolsets: false
  }
}

/** Persist only the dirty sections of the advanced editor. */
async function applyAdvancedConfig(bot, state) {
  const payload = { name: bot }

  if (state.dirtySoul) {
    payload.soul = state.soul
  }

  if (state.dirtyModel && state.model.trim() && state.provider.trim()) {
    payload.model = state.model.trim()
    payload.provider = state.provider.trim()
  }

  if (state.dirtySkills) {
    payload.disabled_skills = state.skills.filter(s => !s.enabled).map(s => s.name)
  }

  if (state.dirtyToolsets) {
    const all = state.toolsets.length
    const enabled = state.toolsets.filter(t => t.enabled)
    // All enabled (or none) = clear the pin; otherwise pin the checked set.
    payload.enabled_toolsets = enabled.length === all || enabled.length === 0 ? [] : enabled.map(t => t.name)
  }

  if (Object.keys(payload).length === 1) {
    return { ok: true, applied: {} }
  }

  return host.request('profiles.configure', payload)
}

// ── edit profile dialog ──────────────────────────────────────────────────────

function labeled(label, control) {
  return jsxs('div', {
    className: 'grid gap-1.5',
    children: [
      jsx('label', {
        className: 'text-xs font-medium text-(--ui-text-secondary)',
        children: label
      }),
      control
    ]
  })
}

function EditProfileDialog({ bot, open, onClose, onDelete }) {
  const metaAll = useValue($botMeta)
  const meta = bot ? metaAll[bot.name] : null
  const appearance = bot ? botAppearance(bot.name, meta) : { shape: 'circle', color: AVATAR_COLORS[3] }
  const [shape, setShape] = useState(appearance.shape)
  const [color, setColor] = useState(appearance.color)
  const [image, setImage] = useState(appearance.image)
  const [title, setTitle] = useState(meta?.title || '')
  const [description, setDescription] = useState(bot?.description || '')
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [adv, setAdv] = useState(emptyAdvancedState())

  // Re-seed local state each time a different bot opens the dialog.
  const [seedKey, setSeedKey] = useState(null)
  const currentKey = bot ? `${bot.name}:${open}` : null
  if (currentKey !== seedKey) {
    setSeedKey(currentKey)
    if (bot && open) {
      setShape(appearance.shape)
      setColor(appearance.color)
      setImage(appearance.image)
      setTitle(meta?.title || '')
      setDescription(bot.description || '')
      setBusy(false)
      setAdvanced(false)
      setAdv(emptyAdvancedState())
    }
  }

  if (!bot) {
    return null
  }

  const submit = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    saveBotMeta(bot.name, { shape, color, image, title: title.trim() })

    const desc = description.trim()
    if (desc !== (bot.description || '').trim()) {
      try {
        await host.request('cli.exec', {
          argv: ['profile', 'describe', bot.name, '--text', desc]
        })
        queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
      } catch (err) {
        host.notifyError(err, 'Saved look locally; description update failed')
      }
    }

    if (adv.loaded && (adv.dirtyModel || adv.dirtySoul || adv.dirtySkills || adv.dirtyToolsets)) {
      try {
        const res = await applyAdvancedConfig(bot.name, adv)
        const failed = Object.entries(res?.applied || {}).filter(([, ok]) => !ok)

        if (failed.length) {
          host.notify({
            kind: 'error',
            message: `Some sections failed: ${failed.map(([k]) => k).join(', ')}`
          })
        }
      } catch (err) {
        host.notifyError(err, 'Advanced configuration failed')
      }
    }

    host.notify({
      kind: 'success',
      message: `${displayName(bot, { title })} updated`
    })
    setBusy(false)
    onClose()
  }

  return jsx(Dialog, {
    open,
    onOpenChange: value => !value && !busy && onClose(),
    children: jsxs(DialogContent, {
      className: advanced ? 'max-w-2xl' : 'max-w-sm',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Edit Profile' }),
            jsx(DialogDescription, {
              children: `Appearance and role for ${displayName(bot, null)} (${bot.name}).`
            })
          ]
        }),
        jsxs('div', {
          className: 'grid gap-4',
          children: [
            jsx('div', {
              className: 'flex justify-center py-1',
              children: jsx(BotFace, {
                shape,
                color,
                image,
                size: 64,
                name: bot.name
              })
            }),
            jsx(AvatarPicker, {
              shape,
              color,
              image,
              onShape: setShape,
              onColor: setColor,
              onImage: setImage,
              generateSeed: { name: bot.name, title, description }
            }),
            labeled(
              'Title',
              jsx(Input, {
                placeholder: displayName(bot, null),
                value: title,
                onChange: event => setTitle(event.target.value)
              })
            ),
            labeled(
              'Description',
              jsx(Textarea, {
                className: 'min-h-16',
                placeholder: 'What should this agent help with?',
                value: description,
                onChange: event => setDescription(event.target.value)
              })
            ),
            jsxs('button', {
              type: 'button',
              className:
                'flex items-center gap-1 text-xs font-medium text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
              onClick: () => setAdvanced(v => !v),
              children: [
                jsx(Codicon, {
                  name: advanced ? 'chevron-down' : 'chevron-right',
                  className: 'text-[0.8rem]'
                }),
                'Advanced — model, skills, toolsets, SOUL.md'
              ]
            }),
            advanced
              ? jsx('div', {
                  className: 'rounded-xl border border-(--ui-stroke-secondary) p-3',
                  children: jsx(AdvancedProfileConfig, {
                    bot: bot.name,
                    state: adv,
                    setState: setAdv
                  })
                })
              : null
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            isProtectedProfile(bot.name)
              ? null
              : jsx(Button, {
                  variant: 'ghost',
                  className: 'mr-auto text-destructive hover:text-destructive',
                  disabled: busy,
                  onClick: () => {
                    onClose()
                    onDelete?.(bot)
                  },
                  children: 'Delete'
                }),
            jsx(Button, {
              variant: 'ghost',
              disabled: busy,
              onClick: onClose,
              children: 'Cancel'
            }),
            jsx(Button, {
              disabled: busy,
              onClick: submit,
              children: busy ? 'Saving…' : 'Save'
            })
          ]
        })
      ]
    })
  })
}

// ── quick create ─────────────────────────────────────────────────────────────

function resolveCreateAgentModel(provider, model, launchProvider, launchModel) {
  const explicitProvider = String(provider || '').trim()
  const explicitModel = String(model || '').trim()

  if (explicitProvider && explicitModel) {
    return { provider: explicitProvider, model: explicitModel }
  }

  const inheritedProvider = String(launchProvider || '').trim()
  const inheritedModel = String(launchModel || '').trim()

  return inheritedProvider && inheritedModel ? { provider: inheritedProvider, model: inheritedModel } : {}
}

// ── routines (cron) ──────────────────────────────────────────────────────────
//
// Jobs are namespaced "[bot:<name>] <routine>". A job running in the active
// bot profile uses the plain instruction; a different profile keeps the
// hermes -p <bot> chat delegation wrapper so the run reaches that bot's
// history. The tile follows the bot you're chatting with (gateway profile).
const BOT_TAG_RE = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i

function routineBot(job) {
  const match = BOT_TAG_RE.exec(job?.name || '')
  return match ? match[1].toLowerCase() : null
}

function routineTitle(job) {
  return (job?.name || '').replace(BOT_TAG_RE, '') || 'Untitled cronjob'
}

function useRoutines() {
  return useQuery({
    queryKey: ROUTINES_KEY,
    queryFn: () => host.request('cron.manage', { action: 'list', include_disabled: true }),
    refetchInterval: 20000,
    staleTime: 8000
  })
}

function normalizedProfileName(profile) {
  return typeof profile === 'string' ? profile.trim().toLowerCase() : ''
}

function routinePrompt(bot, title, instruction, activeProfile) {
  if (normalizedProfileName(bot) && normalizedProfileName(bot) === normalizedProfileName(activeProfile)) {
    return instruction
  }

  return (
    `You are running the scheduled routine "${title}" for agent '${bot}'. ` +
    `Execute it AS that agent so the run lands in its own history: run this in the terminal and relay the output:\n\n` +
    `hermes -p ${bot} chat -c "Routine: ${title}" -q ${JSON.stringify(`[Scheduled routine] ${instruction}`)}\n\n` +
    `If the command fails, report the error instead.`
  )
}
function scheduleLabel(schedule) {
  const once = /^once in (.+)$/.exec(schedule || '')

  if (once) {
    return `Once (${once[1]})`
  }

  const bare = /^(\d+)([mhd])$/.exec(schedule || '')

  if (bare) {
    return `Once (${bare[1]}${bare[2]})`
  }

  const match = /^every (\d+)m$/.exec(schedule || '')

  if (match) {
    const minutes = Number(match[1])

    if (minutes % 1440 === 0) {
      const d = minutes / 1440
      return d === 1 ? 'Daily' : `Every ${d} days`
    }

    if (minutes % 60 === 0) {
      const h = minutes / 60
      return h === 1 ? 'Hourly' : `Every ${h}h`
    }

    return `Every ${minutes}m`
  }

  return schedule || ''
}

function RoutineRow({ job, onChanged }) {
  const [busy, setBusy] = useState(false)
  // Optimistic overlay: null = trust server state. Set immediately on
  // toggle so the switch responds even before the refetch lands.
  const [pendingActive, setPendingActive] = useState(null)
  const serverActive = job.enabled !== false && job.state !== 'paused'
  const active = pendingActive === null ? serverActive : pendingActive

  if (pendingActive !== null && pendingActive === serverActive) {
    setPendingActive(null) // server caught up
  }

  const act = async action => {
    if (busy) {
      return
    }

    setBusy(true)

    if (action === 'pause' || action === 'resume') {
      setPendingActive(action === 'resume')
    }

    try {
      await host.request('cron.manage', { action, name: job.job_id })
      onChanged()
    } catch (err) {
      setPendingActive(null)
      host.notifyError(err, 'Cronjob update failed')
    } finally {
      setBusy(false)
    }
  }

  return jsxs('div', {
    className: cn(
      'group grid gap-1.5 rounded-xl border border-(--ui-stroke-secondary) p-2.5 transition-colors',
      'hover:border-(--ui-stroke-primary, var(--ui-stroke-secondary))'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx(Codicon, {
            name: active ? 'clock' : 'debug-pause',
            'aria-label': active ? 'Active and scheduled' : 'Paused',
            className: cn('shrink-0 text-[0.75rem]', active ? 'text-emerald-400' : 'text-(--ui-text-quaternary)')
          }),
          jsx('span', {
            className: cn('min-w-0 flex-1 truncate text-xs font-medium', !active && 'text-(--ui-text-tertiary)'),
            children: routineTitle(job)
          }),
          jsx(Switch, {
            checked: active,
            disabled: busy,
            onCheckedChange: value => act(value ? 'resume' : 'pause')
          }),
          jsx(Tip, {
            label: 'Delete cronjob',
            children: jsx('button', {
              type: 'button',
              disabled: busy,
              className:
                'flex size-5 items-center justify-center rounded text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100 hover:bg-(--chrome-action-hover) hover:text-foreground',
              onClick: () => act('remove'),
              children: jsx(Codicon, {
                name: 'trash',
                className: 'text-[0.75rem]'
              })
            })
          })
        ]
      }),
      jsxs('div', {
        className: 'flex items-center justify-between gap-2 pl-3.5',
        children: [
          jsxs('span', {
            className:
              'inline-flex items-center gap-1 rounded-full border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.65rem] text-(--ui-text-tertiary)',
            children: [jsx(Codicon, { name: 'calendar', className: 'text-[0.7rem]' }), scheduleLabel(job.schedule)]
          }),
          jsx('span', {
            className: 'truncate text-[0.65rem] text-(--ui-text-quaternary)',
            children: active && job.next_run_at ? `next ${relativeTime(new Date(job.next_run_at).getTime())}` : 'paused'
          })
        ]
      })
    ]
  })
}

// Structured schedule picker: frequency first, then only the detail that
// frequency needs (time of day, weekday, day of month, interval). Emits a
// Hermes-native schedule string; Advanced exposes it raw.
const FREQUENCIES = [
  { id: 'once', label: 'Once, in\u2026' },
  { id: 'hourly', label: 'Every hour' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
  { id: 'interval', label: 'Interval' },
  { id: 'advanced', label: 'Advanced\u2026' }
]

const WEEKDAYS = [
  { id: '1', label: 'Monday' },
  { id: '2', label: 'Tuesday' },
  { id: '3', label: 'Wednesday' },
  { id: '4', label: 'Thursday' },
  { id: '5', label: 'Friday' },
  { id: '6', label: 'Saturday' },
  { id: '0', label: 'Sunday' }
]

const TIMES = (() => {
  const out = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const ampm = h < 12 ? 'AM' : 'PM'
      const h12 = h % 12 === 0 ? 12 : h % 12
      out.push({
        id: `${h}:${m}`,
        label: `${h12}:${String(m).padStart(2, '0')} ${ampm}`,
        h,
        m
      })
    }
  }
  return out
})()

/** Compose the Hermes schedule string from picker state. */
function composeSchedule(state) {
  const [h, m] = (state.time || '9:0').split(':').map(Number)

  switch (state.freq) {
    case 'once': {
      const n = Math.max(1, parseInt(state.onceN, 10) || 1)
      return `${n}${state.onceUnit || 'h'}`
    }
    case 'hourly':
      return 'every 1h'
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'weekly':
      return `${m} ${h} * * ${state.weekday || '1'}`
    case 'monthly':
      return `${m} ${h} ${state.monthday || '1'} * *`
    case 'interval': {
      const n = Math.max(1, parseInt(state.intervalN, 10) || 1)
      return `every ${n}${state.intervalUnit || 'h'}`
    }
    default:
      return state.raw || ''
  }
}

function scheduleSummary(state) {
  const t = TIMES.find(x => x.id === state.time)
  const tl = t ? t.label : '9:00 AM'

  const unitWord = u => (u === 'm' ? 'minute(s)' : u === 'd' ? 'day(s)' : 'hour(s)')
  const cap =
    state.freq !== 'once' && String(state.repeatN || '').trim()
      ? `, ${Math.max(1, parseInt(state.repeatN, 10) || 1)} time(s) total`
      : ''

  switch (state.freq) {
    case 'once':
      return `Runs once, ${Math.max(1, parseInt(state.onceN, 10) || 1)} ${unitWord(state.onceUnit)} from now`
    case 'hourly':
      return 'Runs at the top of every hour' + cap
    case 'daily':
      return `Runs every day at ${tl}` + cap
    case 'weekdays':
      return `Runs Monday\u2013Friday at ${tl}` + cap
    case 'weekly':
      return `Runs every ${(WEEKDAYS.find(w => w.id === state.weekday) || WEEKDAYS[0]).label} at ${tl}` + cap
    case 'monthly':
      return `Runs on day ${state.monthday || '1'} of each month at ${tl}` + cap
    case 'interval':
      return `Runs every ${Math.max(1, parseInt(state.intervalN, 10) || 1)} ${unitWord(state.intervalUnit)}` + cap
    default:
      return 'Raw schedule \u2014 every Nm/Nh/Nd or 5-field cron'
  }
}

function pickerSelect(value, onChange, options) {
  return jsxs(Select, {
    value,
    onValueChange: onChange,
    children: [
      jsx(SelectTrigger, {
        className: 'h-8 rounded-lg',
        children: jsx(SelectValue, {})
      }),
      jsx(SelectContent, {
        children: options.map(o => jsx(SelectItem, { value: o.id, children: o.label }, o.id))
      })
    ]
  })
}

function SchedulePicker({ state, setState }) {
  const upd = patch => setState(prev => ({ ...prev, ...patch }))
  const needsTime = ['daily', 'weekdays', 'weekly', 'monthly'].includes(state.freq)

  return jsxs('div', {
    className: 'grid gap-2',
    children: [
      jsxs('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: needsTime ? '1fr 1fr' : '1fr',
          gap: '8px'
        },
        children: [
          pickerSelect(state.freq, v => upd({ freq: v }), FREQUENCIES),
          needsTime ? pickerSelect(state.time, v => upd({ time: v }), TIMES) : null
        ]
      }),
      state.freq === 'once'
        ? jsxs('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px'
            },
            children: [
              jsx(Input, {
                className: 'h-8',
                placeholder: '30',
                value: state.onceN,
                onChange: event =>
                  upd({
                    onceN: event.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                  })
              }),
              pickerSelect(state.onceUnit, v => upd({ onceUnit: v }), [
                { id: 'm', label: 'minutes from now' },
                { id: 'h', label: 'hours from now' },
                { id: 'd', label: 'days from now' }
              ])
            ]
          })
        : null,
      state.freq === 'weekly' ? pickerSelect(state.weekday, v => upd({ weekday: v }), WEEKDAYS) : null,
      state.freq === 'monthly'
        ? labeled(
            'Day of month',
            jsx(Input, {
              className: 'h-8',
              placeholder: '1',
              value: state.monthday,
              onChange: event =>
                upd({
                  monthday: event.target.value.replace(/[^0-9]/g, '').slice(0, 2)
                })
            })
          )
        : null,
      state.freq === 'interval'
        ? jsxs('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px'
            },
            children: [
              jsx(Input, {
                className: 'h-8',
                placeholder: '2',
                value: state.intervalN,
                onChange: event =>
                  upd({
                    intervalN: event.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                  })
              }),
              pickerSelect(state.intervalUnit, v => upd({ intervalUnit: v }), [
                { id: 'm', label: 'minutes' },
                { id: 'h', label: 'hours' },
                { id: 'd', label: 'days' }
              ])
            ]
          })
        : null,
      state.freq === 'advanced'
        ? jsx(Input, {
            className: 'h-8 font-mono text-xs',
            placeholder: 'every 1d \u00b7 every 2h \u00b7 0 9 * * * (cron)',
            value: state.raw,
            onChange: event => upd({ raw: event.target.value })
          })
        : null,
      state.freq !== 'once' && state.freq !== 'advanced'
        ? jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', {
                className: 'text-xs text-(--ui-text-tertiary)',
                children: 'Stop after'
              }),
              jsx(Input, {
                className: 'h-7 w-16 text-xs',
                placeholder: '\u221e',
                value: state.repeatN,
                onChange: event =>
                  upd({
                    repeatN: event.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                  })
              }),
              jsx('span', {
                className: 'text-xs text-(--ui-text-tertiary)',
                children: 'runs (blank = forever)'
              })
            ]
          })
        : null,
      jsx('div', {
        className: 'text-[0.65rem] text-(--ui-text-quaternary)',
        children: `${scheduleSummary(state)} \u00b7 ${composeSchedule(state) || '\u2014'}`
      })
    ]
  })
}

function defaultScheduleState() {
  return {
    freq: 'daily',
    time: '9:0',
    weekday: '1',
    monthday: '1',
    intervalN: '2',
    intervalUnit: 'h',
    onceN: '30',
    onceUnit: 'm',
    repeatN: '',
    raw: ''
  }
}

function CreateRoutineDialog({ bot, open, onClose }) {
  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')
  const [sched, setSched] = useState(defaultScheduleState())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const activeProfile = useValue(host.state.profile)
  const schedule = composeSchedule(sched)

  const reset = () => {
    setName('')
    setInstruction('')
    setSched(defaultScheduleState())
    setBusy(false)
    setError(null)
  }

  const submit = async () => {
    const title = name.trim()
    const task = instruction.trim()

    if (!title || !task || !schedule.trim() || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const repeatN =
        sched.freq !== 'once' && sched.freq !== 'advanced' && String(sched.repeatN || '').trim()
          ? Math.max(1, parseInt(sched.repeatN, 10) || 1)
          : null
      await host.request('cron.manage', {
        action: 'add',
        name: `[bot:${bot}] ${title}`,
        schedule: schedule.trim(),
        prompt: routinePrompt(bot, title, task, activeProfile),
        ...(repeatN ? { repeat: repeatN } : {})
      })
      queryClient.invalidateQueries({ queryKey: ROUTINES_KEY })
      host.notify({ kind: 'success', message: `Cronjob "${title}" scheduled` })
      reset()
      onClose()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return jsx(Dialog, {
    open,
    onOpenChange: value => {
      if (!value && !busy) {
        reset()
        onClose()
      }
    },
    children: jsxs(DialogContent, {
      className: 'max-w-md',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'New Cronjob' }),
            jsx(DialogDescription, {
              children: `A recurring task ${displayName({ name: bot }, $botMeta.get()[bot])} runs on a schedule. Runs land in its own chat history.`
            })
          ]
        }),
        jsxs('div', {
          className: 'grid gap-3.5',
          children: [
            labeled(
              'Name',
              jsx(Input, {
                autoFocus: true,
                placeholder: 'Name this cronjob',
                value: name,
                onChange: event => setName(event.target.value)
              })
            ),
            labeled(
              'Instruction',
              jsx(Textarea, {
                className: 'min-h-20',
                placeholder: 'What should this cronjob do each time it runs?',
                value: instruction,
                onChange: event => setInstruction(event.target.value)
              })
            ),
            labeled('When to run', jsx(SchedulePicker, { state: sched, setState: setSched })),
            error
              ? jsx('div', {
                  className: 'rounded-xl border border-(--ui-stroke-secondary) px-3 py-2 text-xs text-(--ui-accent)',
                  children: error
                })
              : null
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              variant: 'ghost',
              disabled: busy,
              onClick: () => {
                reset()
                onClose()
              },
              children: 'Cancel'
            }),
            jsx(Button, {
              disabled: busy || !name.trim() || !instruction.trim() || !schedule.trim(),
              onClick: submit,
              children: busy ? 'Scheduling…' : 'Create Cronjob'
            })
          ]
        })
      ]
    })
  })
}

function RoutinesPane() {
  const selected = useValue($selectedBot)
  const gatewayProfile = useValue(host.state.profile)
  // The tile maps to the bot you're chatting with: the live gateway profile
  // is the truth once a chat opens; $selectedBot covers the gap between a
  // roster click and the profile swap landing.
  const bot = (gatewayProfile || selected || 'default').trim() || 'default'
  const meta = useValue($botMeta)[bot]
  const { shape, color, image } = botAppearance(bot, meta)
  const { data, isLoading, refetch } = useRoutines()
  const [createOpen, setCreateOpen] = useState(false)
  const jobs = (data?.jobs ?? []).filter(job => routineBot(job) === bot)

  return jsxs('div', {
    className: 'flex h-full flex-col',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2 px-3 pt-3 pb-2',
        children: [
          jsx(BotFace, { shape, color, image, size: 22, name: bot }),
          jsxs('div', {
            className: 'min-w-0 flex-1',
            children: [
              jsxs('div', {
                className: 'flex min-w-0 items-baseline gap-1.5 truncate',
                children: [
                  jsx('div', {
                    className: 'truncate text-xs font-semibold',
                    children: displayName({ name: bot }, meta)
                  }),
                  showsHandle(bot, meta)
                    ? jsx('span', {
                        className: 'shrink-0 font-mono text-[0.65rem] text-(--ui-text-quaternary)',
                        children: `@${botHandle(bot)}`
                      })
                    : null
                ]
              }),
              jsx('div', {
                className: 'text-[0.65rem] uppercase tracking-wider text-(--ui-text-quaternary)',
                children: 'Cronjobs'
              })
            ]
          }),
          jsx(Tip, {
            label: 'New Cronjob',
            children: jsx('button', {
              type: 'button',
              className:
                'flex size-6 shrink-0 items-center justify-center rounded-md text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
              onClick: () => setCreateOpen(true),
              children: jsx(Codicon, { name: 'add' })
            })
          })
        ]
      }),
      jsx('div', { className: 'mx-3 border-t border-(--ui-stroke-secondary)' }),
      isLoading
        ? jsx('div', {
            className: 'flex flex-1 items-center justify-center',
            children: jsx(GlyphSpinner, {
              spinner: 'breathe',
              className: 'text-(--ui-text-tertiary)'
            })
          })
        : jobs.length === 0
          ? jsxs('div', {
              className: 'flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center',
              children: [
                jsx(Codicon, {
                  name: 'calendar',
                  className: 'text-[1.6rem] text-(--ui-text-quaternary)'
                }),
                jsx('div', {
                  className: 'text-xs leading-5 text-(--ui-text-tertiary)',
                  children: 'Cronjobs are recurring tasks this agent runs on a schedule.'
                }),
                jsx(Button, {
                  variant: 'secondary',
                  size: 'sm',
                  onClick: () => setCreateOpen(true),
                  children: 'Create Cronjob'
                })
              ]
            })
          : jsx(ScrollArea, {
              className: 'min-h-0 flex-1',
              children: jsx('div', {
                className: 'grid gap-1.5 px-2.5 py-2',
                children: jobs.map(job => jsx(RoutineRow, { job, onChanged: () => void refetch() }, job.job_id))
              })
            }),
      jsx(CreateRoutineDialog, {
        bot,
        open: createOpen,
        onClose: () => {
          setCreateOpen(false)
          void refetch()
        }
      })
    ]
  })
}

// ── Grok-style recipient / group-chat surface ───────────────────────────────

function BotStack({ participantIds, size = 30 }) {
  const shown = participantIds
  const botMeta = useValue($botMeta)
  const overlap = Math.round(size * 0.38)

  return jsx('div', {
    className: 'flex shrink-0 items-center',
    children: shown.map((name, index) => {
      const meta = botMeta[name]
      const appearance = botAppearance(name, meta)

      return jsx(
        'div',
        {
          // Overlap pulls each face over its neighbour — so it belongs on
          // every face EXCEPT the last. Applying it to the last one (with a
          // container padding that never quite compensated) left the stack
          // 11px narrower than its faces, and the adjacent label rendered on
          // top of the final avatar. The avatars themselves provide enough
          // silhouette contrast; black separator rings made profile shapes
          // look like generic circles and hid their real artwork.
          className: 'relative',
          style: {
            marginRight: index < shown.length - 1 ? `${-overlap}px` : undefined,
            zIndex: shown.length - index
          },
          children: jsx(BotFace, {
            ...appearance,
            size,
            name,
            mood: 'idle'
          })
        },
        name
      )
    })
  })
}

function ConversationDraftRow({ draft, roster }) {
  const title = draft.participantIds.length ? groupTitle(draft.participantIds, roster) : 'Create new'

  return jsxs('button', {
    type: 'button',
    className: 'mx-2.5 mb-1 flex items-center gap-2.5 rounded-2xl bg-(--chrome-action-hover) px-2 py-2 text-left',
    onClick: () => {
      $activeGroupId.set(null)
      $newConversation.set({ ...draft })
    },
    'aria-label': `New chat draft: ${title}`,
    children: [
      draft.participantIds.length
        ? jsx(BotStack, { participantIds: draft.participantIds, size: 30 })
        : jsx('span', {
            className:
              'grid size-[30px] shrink-0 place-items-center rounded-full bg-(--ui-control-active-background) text-(--ui-text-secondary)',
            children: jsx(Codicon, { name: 'add', size: '0.8rem' })
          }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', {
            className: 'truncate text-[0.8125rem] font-medium',
            children: title
          }),
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-tertiary)',
            children: draft.participantIds.length > 1 ? 'New group' : 'Choose bots'
          })
        ]
      })
    ]
  })
}

function BotGroupRow({ group, roster, onDelete }) {
  const active = useValue($activeGroupId) === group.id

  const row = jsxs('button', {
    type: 'button',
    className: cn(
      'flex w-full items-center gap-2.5 rounded-2xl border border-transparent px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)',
      active && 'border-(--ui-stroke-secondary) bg-(--ui-control-active-background)'
    ),
    style: { borderRadius: '18px' },
    onClick: () => void openBotGroup(group),
    children: [
      jsx(BotStack, { participantIds: group.participantIds, size: 34 }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-baseline justify-between gap-2',
            children: [
              jsx('span', {
                className: 'min-w-0 truncate text-[0.8125rem] font-medium',
                children: group.title
              }),
              group.lastActive
                ? jsx('span', {
                    className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: conversationTime(group.lastActive)
                  })
                : null
            ]
          }),
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-tertiary)',
            children: group.preview || `${group.participantIds.length} bots`
          })
        ]
      })
    ]
  })

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children: row }),
      jsx(ContextMenuContent, {
        children: jsx(ContextMenuItem, {
          variant: 'destructive',
          onSelect: () => onDelete?.(group),
          children: 'Delete group'
        })
      })
    ]
  })
}

// ── provider brand marks ─────────────────────────────────────────────────────

/** Ported verbatim from the Orgo Bot picker so the two products read the same.
 *  Inline SVG: Bot Mode carries no icon dependency of its own, and `fill-current`
 *  lets each mark inherit the row's colour (dimmed when a provider is off). */
function GrokMark({ className, size = 16 }) {
  return jsxs('svg', {
    className: cn('fill-current', className),
    height: size,
    viewBox: '0 0 24 24',
    width: size,
    children: [jsx('path', { d: 'M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861' }), jsx('path', { d: 'M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257' })]
  })
}

function OpenAiMark({ className, size = 16 }) {
  return jsx('svg', {
    className: cn('fill-current', className),
    height: size,
    preserveAspectRatio: 'xMidYMid',
    viewBox: '0 0 256 260',
    width: size,
    children: jsx('path', { d: 'M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z' })
  })
}

function ProviderMark({ className, id, size = 16 }) {
  return id === 'grok' ? jsx(GrokMark, { className, size }) : jsx(OpenAiMark, { className, size })
}

// ── provider switch (Grok / OpenAI, per bot) ─────────────────────────────────

/** The two providers Bot Mode offers in the chat header, mirroring the Orgo
 *  Bot picker. Each entry lists its concrete Hermes slugs in preference order
 *  — the subscription login first, the direct API key second — because either
 *  credential satisfies the same user-facing choice. */
const BOT_PROVIDER_CHOICES = [
  { candidates: ['xai-oauth', 'xai'], id: 'grok', label: 'Grok' },
  { candidates: ['openai-codex', 'openai-api'], id: 'openai', label: 'OpenAI' }
]

/** First model id on a provider row. Rows arrive flagship-first (the gateway
 *  applies its curated order), and a row's entries are either bare ids or
 *  `{ id }` objects — both shapes ship from model.options. */
function firstProviderModel(row) {
  const models = Array.isArray(row?.models) ? row.models : []
  const first = models[0]

  return typeof first === 'string' ? first : first?.id || ''
}

/** Every model id on a provider row, normalised — model.options ships bare
 *  ids for some providers and `{ id }` objects for others. */
function providerModelIds(row) {
  const models = Array.isArray(row?.models) ? row.models : []

  return models.map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean)
}

/** One honest sentence for a multi-bot apply. Never claims more than it did:
 *  a partial result names the bots that failed rather than reporting success
 *  with a silent remainder. */
function applyOutcomeSummary(label, applied, failed) {
  const bots = count => `${count} bot${count === 1 ? '' : 's'}`

  if (!failed.length) {
    return `${bots(applied.length)} moved to ${label}.`
  }

  if (!applied.length) {
    return `Could not move any bot to ${label}: ${failed.join(', ')}.`
  }

  return `${bots(applied.length)} moved to ${label}; ${failed.join(', ')} failed.`
}

/** Health of the provider a bot is pinned to, against a live `model.options`
 *  payload. Three states, deliberately: 'ok' and 'unconfigured' are claims we
 *  can defend, and 'unknown' (inventory not loaded, or the bot inherits the
 *  gateway default) renders NOTHING — a roster that cries wolf while the
 *  query is still in flight is worse than one that stays quiet. */
function providerHealth(rows, provider) {
  const slug = String(provider || '').toLowerCase()
  const list = Array.isArray(rows) ? rows : []

  if (!slug || !list.length) {
    return { reason: '', state: 'unknown' }
  }

  const row = list.find(entry => String(entry?.slug || '').toLowerCase() === slug)

  if (!row) {
    return { reason: `${slug} is not configured on this gateway`, state: 'unconfigured' }
  }

  return row.authenticated === false
    ? { reason: `${slug} is not connected`, state: 'unconfigured' }
    : { reason: '', state: 'ok' }
}

/** Resolve one header choice against a live `model.options` payload. A
 *  provider with no usable row still resolves — the menu renders it disabled
 *  rather than hiding it, so "Grok isn't connected on THIS backend" stays
 *  visible instead of looking like the option never existed. */
function resolveProviderChoice(rows, candidates) {
  const list = Array.isArray(rows) ? rows : []

  for (const slug of candidates) {
    const row = list.find(entry => String(entry?.slug || '').toLowerCase() === slug)
    const model = firstProviderModel(row)

    if (row && model) {
      return { model, ready: true, slug }
    }
  }

  return { model: '', ready: false, slug: candidates[0] }
}

/** Which header choice a profile's saved provider belongs to — `xai-oauth` and
 *  `xai` are one user-facing option, as are the two OpenAI slugs. */
function providerChoiceFor(provider) {
  const slug = String(provider || '').toLowerCase()

  return BOT_PROVIDER_CHOICES.find(choice => choice.candidates.includes(slug)) || null
}

/** Per-bot provider switch, shaped like the Orgo Bot model picker: a pill
 *  trigger, then a two-pane panel — provider rail on the left, that provider's
 *  models on the right. Writes through `profiles.configure`, which is
 *  profile-scoped, so a pick retargets THIS bot alone. Switching a whole group
 *  means switching each participant. */
function ProviderSwitch({ variant = 'pill' } = {}) {
  const activeProfile = useValue(host.state.profile)
  const draft = useValue($newConversation)
  const activeGroupId = useValue($activeGroupId)
  const groups = useValue($botGroups)
  const { data: rosterData } = useRoster()
  const { data: modelOptions } = useModelOptions()
  const [open, setOpen] = useState(false)
  const [railId, setRailId] = useState(null)
  const [saving, setSaving] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const onDown = event => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const onKey = event => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const roster = Array.isArray(rosterData?.profiles) ? rosterData.profiles : $lastRoster.get()
  const bot = roster.find(entry => entry.name === activeProfile)

  // Bot Mode shares the chat header with ordinary Hermes chats; only a real
  // roster profile gets the switch.
  if (!bot) {
    return null
  }

  const rows = (modelOptions?.providers || []).filter(row => (row.models || []).length)
  const choices = BOT_PROVIDER_CHOICES.map(choice => ({
    ...choice,
    ...resolveProviderChoice(rows, choice.candidates)
  }))
  // In a group, the provider that matters is every participant's — fixing a
  // group off a dead credential otherwise means visiting each bot's own chat
  // with no surface that shows which one is actually failing.
  const conversation = draft || (activeGroupId ? groups[activeGroupId] : null)
  const participants = (conversation?.participantIds || [])
    .map(name => roster.find(entry => entry.name === name))
    .filter(Boolean)
  const isGroup = participants.length > 1
  const current = providerChoiceFor(bot.provider)
  const railChoice = choices.find(choice => choice.id === (railId || current?.id)) || choices[0]
  const railRow = rows.find(row => String(row.slug || '').toLowerCase() === railChoice.slug)
  const railModels = providerModelIds(railRow)

  const applyToAll = async (choice, model) => {
    if (saving || !choice.ready || !model) {
      return
    }

    haptic('tap')
    setSaving(true)

    const applied = []
    const failed = []

    try {
      for (const participant of participants) {
        try {
          const result = await host.request('profiles.configure', {
            model,
            name: participant.name,
            provider: choice.slug
          })

          if (result?.applied?.model === false) {
            failed.push(participant.name)
          } else {
            applied.push(participant.name)
          }
        } catch {
          failed.push(participant.name)
        }
      }

      queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
      host.notify({
        kind: failed.length ? 'error' : 'info',
        message: `${applyOutcomeSummary(choice.label, applied, failed)} Open a new chat for it to take effect.`
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const pick = async (choice, model) => {
    if (saving || !choice.ready || !model) {
      return
    }

    if (choice.id === current?.id && model === bot.model) {
      setOpen(false)

      return
    }

    haptic('tap')
    setSaving(true)

    try {
      const result = await host.request('profiles.configure', {
        model,
        name: bot.name,
        provider: choice.slug
      })

      // profiles.configure applies each section best-effort and reports the
      // outcome per section — a transport-level success can still carry a
      // failed model pin. Say so rather than letting the header re-render as
      // if the bot had moved providers.
      if (result?.applied?.model === false) {
        host.notify({
          kind: 'error',
          message: `Could not move ${bot.name} to ${choice.label} — the model pin was rejected.`
        })
      }

      queryClient.invalidateQueries({ queryKey: ROSTER_KEY })

      // profiles.configure writes the profile's DISK config. A spawned agent
      // owns its own live provider/model for the rest of its session (see
      // model.options in tui_gateway), and the gateway exposes no session-model
      // setter — the core composer uses a REST route plugins can't reach. So
      // an open chat keeps the provider it started on, and staying silent here
      // reads as "the switch did nothing" when the old provider 429s.
      if (result?.applied?.model !== false) {
        host.notify({
          kind: 'info',
          message: `${bot.name} now uses ${choice.label} (${model}). Open a new chat with ${bot.name} — this one keeps the provider it started on.`
        })
      }

      setOpen(false)
    } catch (err) {
      host.notifyError(err, `Could not move ${bot.name} to ${choice.label}`)
    } finally {
      setSaving(false)
    }
  }

  const isRow = variant === 'row'

  return jsxs('div', {
    // Header variant: an ordinary flex item inside the bot chat header row —
    // pointer events and the titlebar no-drag escape are carried by that row.
    // Row variant: a full-width sidebar item in the pane footer.
    className: isRow ? 'relative' : 'relative ml-auto shrink-0',
    ref: rootRef,
    children: [
      jsxs('button', {
        className: cn(
          isRow
            ? 'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-(--ui-control-active-background)'
            : 'flex items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--ui-control-active-background)',
          saving && 'opacity-60'
        ),
        disabled: saving,
        onClick: () => {
          setRailId(current?.id || choices[0].id)
          setOpen(value => !value)
        },
        title: current ? `${current.label} · ${bot.model || 'gateway default'}` : 'Choose a provider',
        type: 'button',
        children: isRow
          ? [
              jsx('span', {
                className: cn(
                  'grid size-7 shrink-0 place-items-center rounded-full',
                  'bg-(--ui-control-active-background) text-(--ui-text-secondary)'
                ),
                children: current
                  ? jsx(ProviderMark, { id: current.id, size: 13 })
                  : jsx(Codicon, { name: 'circuit-board', size: '0.7rem' })
              }),
              jsxs('span', {
                className: 'grid min-w-0 flex-1',
                children: [
                  jsx('span', {
                    className: 'truncate text-[0.78rem] font-medium leading-4',
                    children: current?.label || 'Model'
                  }),
                  jsx('span', {
                    className: 'truncate text-[0.65rem] leading-4 text-(--ui-text-tertiary)',
                    children: bot.model || 'gateway default'
                  })
                ]
              })
            ]
          : [
              current ? jsx(ProviderMark, { id: current.id, size: 13 }) : null,
              jsx('span', {
                className: 'max-w-[132px] truncate',
                children: bot.model || current?.label || 'Provider'
              }),
              jsx(Codicon, { className: 'text-[0.65rem] text-(--ui-text-tertiary)', name: 'chevron-down' })
            ]
      }),
      open
        ? jsxs('div', {
            className: cn(
              'absolute z-30 overflow-hidden rounded-xl',
              // The footer lives in a 280px pane, so a 320px two-pane menu
              // overflowed and was clipped into nonsense. There it opens
              // upward, fills the pane's width, and stacks its two columns.
              isRow ? 'inset-x-0 bottom-full mb-2 flex flex-col' : 'right-0 top-full mt-2 flex w-[320px]',
              // --ui-panel-background carries alpha in this theme; without a
              // blur the roster reads straight through the menu and the two
              // layers merge into noise.
              'border border-(--ui-stroke-secondary) bg-(--ui-panel-background) backdrop-blur-xl shadow-nous'
            ),
            children: [
              // provider rail
              jsx('div', {
                className: cn(
                  'flex gap-1 p-2',
                  isRow
                    ? 'border-b border-(--ui-stroke-secondary)'
                    : 'flex-col border-r border-(--ui-stroke-secondary)'
                ),
                children: choices.map(choice =>
                  jsx(
                    'button',
                    {
                      className: cn(
                        'flex size-9 items-center justify-center rounded-lg',
                        choice.id === railChoice.id
                          ? 'bg-(--ui-control-active-background)'
                          : 'hover:bg-(--ui-control-active-background)/60',
                        !choice.ready && 'opacity-40'
                      ),
                      onClick: () => setRailId(choice.id),
                      title: choice.ready ? choice.label : `${choice.label} — not connected on this backend`,
                      type: 'button',
                      children: jsx(ProviderMark, { id: choice.id, size: 18 })
                    },
                    choice.id
                  )
                )
              }),
              // the rail provider's models
              jsxs('div', {
                className: 'min-w-0 flex-1 p-2',
                children: [
                  jsxs('div', {
                    className: 'px-2 pb-1 pt-1',
                    children: [
                      jsx('div', { className: 'text-[13px] font-semibold', children: railChoice.label }),
                      jsx('div', {
                        className: 'truncate text-[11px] text-(--ui-text-tertiary)',
                        children: railChoice.ready
                          ? `${railChoice.slug} · ${railModels.length} models`
                          : 'Not connected — run `hermes auth` on this backend'
                      })
                    ]
                  }),
                  railChoice.ready
                    ? jsx('div', {
                        className: 'max-h-[280px] overflow-y-auto',
                        children: railModels.map(model =>
                          jsxs(
                            'button',
                            {
                              className: cn(
                                'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
                                saving
                                  ? 'cursor-not-allowed text-(--ui-text-tertiary)'
                                  : 'hover:bg-(--ui-control-active-background)/60',
                                current?.id === railChoice.id && model === bot.model && 'bg-(--ui-control-active-background)'
                              ),
                              disabled: saving,
                              onClick: () => pick(railChoice, model),
                              type: 'button',
                              children: [
                                jsxs('span', {
                                  className: 'flex min-w-0 items-center gap-2',
                                  children: [
                                    jsx('span', { className: 'truncate', children: model }),
                                    model === railModels[0]
                                      ? jsx('span', {
                                          className:
                                            'shrink-0 rounded bg-(--ui-control-active-background) px-1 py-px text-[10px] text-(--ui-text-tertiary)',
                                          children: 'default'
                                        })
                                      : null
                                  ]
                                }),
                                current?.id === railChoice.id && model === bot.model
                                  ? jsx(Codicon, {
                                      className: 'shrink-0 text-[0.7rem] text-(--ui-accent)',
                                      name: 'check'
                                    })
                                  : null
                              ]
                            },
                            model
                          )
                        )
                      })
                    : jsx('div', {
                        className: 'px-2 py-3 text-[13px] text-(--ui-text-tertiary)',
                        children: `${railChoice.label} has no authenticated credential on this gateway.`
                      }),
                  // A group is only as healthy as its worst participant, so
                  // show them all and let one action fix the set.
                  isGroup
                    ? jsxs('div', {
                        className: 'mt-1 border-t border-(--ui-stroke-secondary) pt-2',
                        children: [
                          jsx('div', {
                            className: 'px-2 pb-1 text-[11px] text-(--ui-text-tertiary)',
                            children: `In this chat · ${participants.length} bots`
                          }),
                          ...participants.map(participant => {
                            const state = providerHealth(rows, participant.provider)

                            return jsxs(
                              'div',
                              {
                                className: 'flex items-center justify-between gap-2 px-2 py-0.5 text-[11px]',
                                children: [
                                  jsx('span', {
                                    className: 'truncate text-(--ui-text-secondary)',
                                    children: participant.name
                                  }),
                                  jsx('span', {
                                    className: cn(
                                      'shrink-0 truncate',
                                      state.state === 'unconfigured'
                                        ? 'text-(--ui-warning,#d6a648)'
                                        : 'text-(--ui-text-quaternary)'
                                    ),
                                    title: state.reason || undefined,
                                    children: participant.model || 'gateway default'
                                  })
                                ]
                              },
                              participant.name
                            )
                          }),
                          railChoice.ready
                            ? jsx('button', {
                                className: cn(
                                  'mt-1.5 w-full rounded-lg px-2 py-1.5 text-left text-[12px]',
                                  saving
                                    ? 'cursor-not-allowed text-(--ui-text-tertiary)'
                                    : 'text-(--ui-accent) hover:bg-(--ui-control-active-background)/60'
                                ),
                                disabled: saving,
                                onClick: () => applyToAll(railChoice, railModels[0]),
                                type: 'button',
                                children: `Use ${railChoice.label} for all ${participants.length} bots`
                              })
                            : null
                        ]
                      })
                    : null
                ]
              })
            ]
          })
        : null
    ]
  })
}

/** THE bot chat header row. One flex line: recipients take the flexible
 *  middle, controls trail. Previously the recipients row was an opaque
 *  absolute sheet and every sibling control had to out-rank it and reserve
 *  width by hand — the next control added would have hit the same wall. */
const BOT_CHAT_HEADER_ROW =
  'pointer-events-auto absolute inset-0 z-30 flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) px-2.5 [-webkit-app-region:no-drag]'

function RecipientHeader() {
  const activeProfile = useValue(host.state.profile)
  const draft = useValue($newConversation)
  const activeGroupId = useValue($activeGroupId)
  const groups = useValue($botGroups)
  const { data } = useRoster()
  const launchModel = useValue(host.state.model)
  const launchProvider = host.state.provider ? useValue(host.state.provider) : ''
  const activeSessionId = host.state.activeSessionId ? useValue(host.state.activeSessionId) : ''
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)
  const botMeta = useValue($botMeta)
  const group = activeGroupId ? groups[activeGroupId] : null
  const conversation = draft || group
  const roster = filterDeletedRoster(
    Array.isArray(data?.profiles) ? data.profiles : $lastRoster.get()
  )
  const participantIds = conversation?.participantIds || []

  useEffect(() => {
    if (!draft) {
      return undefined
    }

    // Opening the first recipient's canonical chat remounts the workspace and
    // would otherwise blur/close the picker before a second recipient can be
    // chosen. Reassert the New-flow focus at the beginning and after the
    // active session changes; the final delayed pass covers remote hydration.
    const refocus = () => {
      inputRef.current?.focus()
      setPickerOpen(true)
    }
    const timers = [0, 180, 520].map(delay => window.setTimeout(refocus, delay))

    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [draft?.id, activeSessionId])

  useEffect(() => {
    setQuery('')
    // Land on the first existing bot, not the create row — a stray Enter on
    // an empty query should open a teammate, never mint a new one. Typing
    // moves the cursor to the refined create row, where Enter means create.
    setCursor(1)
  }, [draft?.id, activeGroupId])

  // A direct bot chat gets an identity strip — the bot's face and name at
  // the top of the transcript, exactly where a group chat shows its To: row.
  // Grok Bot does the same; without it the removal of the old model pill had
  // left direct chats headless and anonymous.
  if (!conversation) {
    const bot = botFromRoster(activeProfile, roster)

    if (!bot) {
      return null
    }

    const meta = botMeta[bot.name]
    const { shape, color, image } = botAppearance(bot.name, meta)

    return jsxs('div', {
      className: BOT_CHAT_HEADER_ROW,
      'data-hermes-bot-chat-header': '',
      children: [
        jsx(BotFace, { color, image, mood: 'idle', name: bot.name, shape, size: 18 }),
        jsx('span', {
          className: 'truncate text-[10px] font-medium',
          children: participantLabel(bot.name, roster)
        })
      ]
    })
  }

  const needle = query.trim().toLowerCase()
  const available = roster.filter(bot => {
    if (participantIds.includes(bot.name)) {
      return false
    }

    if (!needle) {
      return true
    }

    const label = participantLabel(bot.name, roster).toLowerCase()

    return bot.name.toLowerCase().includes(needle) || label.includes(needle)
  })
  const options = [
    // "Create new Bot" leads the list permanently, as in Grok Bot — typing a
    // name refines it into `Create "name"`. createQuickBot already falls back
    // to the default name on an empty query.
    ...(needle
      ? [
          {
            kind: 'create',
            key: `create:${needle}`,
            label: `Create “${query.trim()}”`
          }
        ]
      : [
          {
            kind: 'create',
            key: 'create:new',
            label: 'Create new Bot'
          }
        ]),
    ...available.map(bot => ({
      kind: 'bot',
      key: bot.name,
      label: participantLabel(bot.name, roster),
      bot
    }))
  ]
  const selected = options.length ? options[Math.min(cursor, options.length - 1)] : null

  const addBot = async bot => {
    const current = $newConversation.get() || ($activeGroupId.get() ? $botGroups.get()[$activeGroupId.get()] : null)

    if (!current || current.participantIds.includes(bot.name)) {
      return
    }

    const nextIds = [...current.participantIds, bot.name]
    setQuery('')
    setCursor(0)

    if ($newConversation.get()) {
      const becameGroup = nextIds.length > 1 && current.participantIds.length < 2
      $newConversation.set({ ...current, participantIds: nextIds })

      $selectedBot.set(nextIds[0])
      $activeGroupId.set(null)

      if (nextIds.length === 1) {
        await openBotChat(botFromRoster(nextIds[0], roster), { preserveDraft: true, quiet: true })
      } else if (becameGroup && typeof host.newChat === 'function') {
        const intent = claimNavigationIntent(`draft:${current.id}`)

        if (isCurrentNavigationIntent(intent)) {
          host.newChat(nextIds[0])
        }
      }
    } else {
      patchBotGroup(current.id, {
        participantIds: nextIds,
        title: groupTitle(nextIds, roster)
      })
    }

    window.setTimeout(() => inputRef.current?.focus(), 250)
  }

  const choose = async option => {
    if (!option || creating) {
      return
    }

    if (option.kind === 'bot') {
      await addBot(option.bot)

      return
    }

    setCreating(true)
    try {
      const bot = await createQuickBot(query.trim() || 'New Bot', roster, launchProvider, launchModel)
      await addBot(bot)
      host.notify({
        kind: 'success',
        message: `${participantLabel(bot.name, [...roster, bot])} created`
      })
    } catch (error) {
      host.notifyError(error, 'Could not create bot')
    } finally {
      setCreating(false)
    }
  }

  const removeDraftBot = async name => {
    const current = $newConversation.get()

    if (!current) {
      return
    }

    const nextIds = current.participantIds.filter(id => id !== name)
    $newConversation.set({ ...current, participantIds: nextIds })

    if (nextIds.length === 1) {
      $selectedBot.set(nextIds[0])
      await openBotChat(botFromRoster(nextIds[0], roster), { preserveDraft: true, quiet: true })
    }
  }

  return jsxs('div', {
    className: BOT_CHAT_HEADER_ROW,
    'data-hermes-bot-chat-header': '',
    children: [
      jsx('span', {
        className: 'shrink-0 text-[10px] text-(--ui-text-tertiary)',
        children: 'To:'
      }),
      ...participantIds.map(name =>
        jsxs(
          'span',
          {
            className:
              'inline-flex h-6 max-w-44 shrink-0 items-center gap-1.5 overflow-hidden rounded-full bg-(--ui-control-active-background) py-0 pl-1 pr-2 text-[11px] leading-none text-(--ui-text-secondary)',
            children: [
              jsx(BotFace, {
                ...botAppearance(name, botMeta[name]),
                name,
                size: 14,
                mood: 'idle'
              }),
              jsx('span', {
                className: 'truncate',
                children: participantLabel(name, roster)
              }),
              draft
                ? jsx('button', {
                    type: 'button',
                    className: 'grid size-3 place-items-center rounded-full hover:bg-(--chrome-action-hover)',
                    'aria-label': `Remove ${participantLabel(name, roster)}`,
                    onClick: () => void removeDraftBot(name),
                    children: jsx(Codicon, { name: 'close', size: '0.45rem' })
                  })
                : null
            ]
          },
          name
        )
      ),
      // The panel used to be an absolute child of this row. The row lives in
      // the titlebar's stacking maze, where the panel's top was painted over
      // by whichever sibling context won — a Radix Popover portals the panel
      // to the body, outside every one of those contexts, and positions it
      // against the anchor with collision handling for free.
      jsxs(Popover, {
        modal: false,
        onOpenChange: setPickerOpen,
        open: pickerOpen,
        children: [
          jsx(PopoverTrigger, {
            asChild: true,
            children: jsx('div', {
              className: 'relative min-w-[9rem] flex-1 self-stretch',
              // Radix toggles a popover on trigger click, which would CLOSE
              // the picker when clicking into the input. Its composed handlers
              // respect defaultPrevented, so this opts out of the toggle while
              // leaving focus (which happens on mousedown) intact.
              onClick: event => event.preventDefault(),
              children: jsx('div', {
                className: 'flex h-full items-center',
                children: jsx('input', {
              ref: inputRef,
              value: query,
              disabled: creating,
              className:
                'h-6 w-full min-w-0 bg-transparent px-1 text-[10px] text-foreground outline-none placeholder:text-(--ui-text-quaternary)',
              placeholder: participantIds.length ? 'Add or create another Bot' : 'Search or create Bots',
              'aria-label': 'Search or create Bots',
              onFocus: () => setPickerOpen(true),
              onBlur: () => window.setTimeout(() => setPickerOpen(false), 120),
              onChange: event => {
                setQuery(event.target.value)
                setCursor(event.target.value.trim() ? 0 : 1)
                setPickerOpen(true)
              },
              onKeyDown: event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor(value => Math.min(options.length - 1, value + 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor(value => Math.max(0, value - 1))
                } else if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  void choose(selected)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  if (pickerOpen) {
                    setPickerOpen(false)
                  } else if (draft) {
                    void closeNewConversation()
                  }
                }
              }
            }),
              })
            })
          }),
          jsx(PopoverContent, {
            align: 'start',
            side: 'bottom',
            sideOffset: 4,
            // Focus stays in the To: input; the panel is browse-only chrome.
            onOpenAutoFocus: event => event.preventDefault(),
            className:
              'z-[100] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-panel-background) p-1 shadow-nous backdrop-blur-xl',
                  role: 'listbox',
                  'aria-label': 'Recipients',
                  children: jsxs('div', {
                    children: [
                      ...options.map((option, index) =>
                    jsxs(
                      'button',
                      {
                        type: 'button',
                        role: 'option',
                        'aria-selected': index === cursor,
                        className: cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                          index === cursor ? 'bg-(--ui-control-active-background)' : 'hover:bg-(--chrome-action-hover)'
                        ),
                        onMouseDown: event => event.preventDefault(),
                        onMouseEnter: () => setCursor(index),
                        onClick: () => void choose(option),
                        children: [
                          option.kind === 'create'
                            ? jsx('span', {
                                className:
                                  'grid size-5 shrink-0 place-items-center rounded-full bg-(--ui-control-active-background)',
                                children: creating
                                  ? jsx(GlyphSpinner, { spinner: 'breathe' })
                                  : jsx(Codicon, {
                                      name: 'add',
                                      size: '0.65rem'
                                    })
                              })
                            : jsx(BotFace, {
                                ...botAppearance(option.bot.name, botMeta[option.bot.name]),
                                name: option.bot.name,
                                size: 20,
                                mood: 'idle'
                              }),
                          jsx('span', {
                            className: 'min-w-0 flex-1 truncate',
                            children: option.label
                          }),
                        ]
                      },
                      option.key
                    )
                  ),
                      // The key legend Grok Bot keeps in the picker's corner:
                      // Tab adds a recipient and keeps composing, Enter opens.
                      jsxs('div', {
                        className:
                          'mt-1 flex items-center justify-end gap-2 border-t border-(--ui-stroke-secondary) px-2 pb-0.5 pt-1.5 text-[0.62rem] text-(--ui-text-tertiary)',
                        children: [
                          jsxs('span', {
                            className: 'flex items-center gap-1',
                            children: [
                              jsx('kbd', {
                                className:
                                  'rounded bg-(--ui-control-active-background) px-1 py-px font-sans text-[0.6rem]',
                                children: 'Tab'
                              }),
                              'add'
                            ]
                          }),
                          jsxs('span', {
                            className: 'flex items-center gap-1',
                            children: [
                              jsx('kbd', {
                                className:
                                  'rounded bg-(--ui-control-active-background) px-1 py-px font-sans text-[0.6rem]',
                                children: '⏎'
                              }),
                              'open'
                            ]
                          })
                        ]
                      })
                    ]
                  })
          })
        ]
      }),
      draft
        ? jsx('button', {
            type: 'button',
            className:
              'grid size-6 shrink-0 place-items-center rounded-md text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
            'aria-label': 'Close new chat',
            onClick: () => void closeNewConversation(),
            children: jsx(Codicon, { name: 'close', size: '0.7rem' })
          })
        : null
    ]
  })
}

// ── roster pane ──────────────────────────────────────────────────────────────

/** The pinned shelf: your regulars as tiles — face, name, and the role chip
 *  from the profile's title. Grok Bot puts these above the conversation list,
 *  which is why a pinned agent is one glance and one click away rather than
 *  somewhere in a scrolling roster. */
function PinnedStrip({ bots, onEdit, onDelete }) {
  const botMeta = useValue($botMeta)
  const activeProfile = useValue(host.state.profile)
  const activeGroupId = useValue($activeGroupId)
  const draft = useValue($newConversation)
  const [dropActive, setDropActive] = useState(false)

  return jsx('div', {
    className: cn(
      'flex flex-wrap justify-center gap-x-3 gap-y-3 rounded-2xl px-3 pb-3 pt-1 transition-colors',
      bots.length ? 'min-h-3' : 'min-h-12',
      dropActive && 'bg-(--ui-control-hover-background) ring-1 ring-inset ring-(--ui-stroke-secondary)'
    ),
    'aria-label': 'Pinned bots',
    'data-hermes-bots-pinned-shelf': '',
    onDragEnter: event => {
      event.preventDefault()
      setDropActive(true)
    },
    onDragOver: event => {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    },
    onDragLeave: event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setDropActive(false)
      }
    },
    onDrop: event => {
      event.preventDefault()
      event.stopPropagation()
      const name = readDraggedBot(event)

      if (name) {
        movePinnedBot(name)
      }

      setDropActive(false)
      finishBotDrag()
    },
    children: bots.map(bot => {
      const { shape, color, image } = botAppearance(bot.name, botMeta[bot.name])
      const meta = botMeta[bot.name]
      const label = participantLabel(bot.name, [bot])
      const isActive = !activeGroupId && !draft && bot.name === activeProfile
      // The chip is for a ROLE — "Social", "Executive assistant" — not an
      // echo. Quick-created bots have title === name, and a chip that repeats
      // the label directly under it is noise, so it only renders when it says
      // something the name does not.
      const roleSource = (meta?.title || bot.description || '').trim()
      const role = roleSource.toLowerCase() === label.toLowerCase() ? '' : roleSource

      return jsx(
        'div',
        {
          // Width is an INLINE STYLE, deliberately: the app's Tailwind CSS is
          // compiled without scanning this plugin, so an arbitrary-value class
          // like w-[80px] that the app itself never uses simply does not
          // exist — the tile silently rendered at content width, and a long
          // role chip ballooned it across the pane. Only standard utilities
          // are safe here; anything bespoke goes through style.
          className: 'min-w-0 shrink-0 overflow-hidden',
          style: { width: '80px' },
          children: jsxs(ContextMenu, {
          children: [
            jsx(ContextMenuTrigger, {
              asChild: true,
              children: jsxs('button', {
                // min-w-0 here as well: w-full still yields to min-width:auto,
                // so without it the button balloons OUT of its 80px wrapper to
                // the chip text's nowrap width and drags the avatar with it.
                className: cn(
                  'group flex w-full min-w-0 flex-col items-center gap-1.5 overflow-hidden rounded-2xl px-2 py-2 transition-colors',
                  isActive && 'bg-(--ui-control-active-background) ring-1 ring-inset ring-(--ui-stroke-secondary)'
                ),
                style: { borderRadius: '18px' },
                draggable: true,
                onDragStart: event => startBotDrag(event, bot.name),
                onDragEnd: finishBotDrag,
                onDragOver: event => {
                  event.preventDefault()
                  event.stopPropagation()
                },
                onDrop: event => {
                  event.preventDefault()
                  event.stopPropagation()
                  const name = readDraggedBot(event)

                  if (name && name !== bot.name) {
                    movePinnedBot(name, bot.name)
                  }

                  setDropActive(false)
                  finishBotDrag()
                },
                onClick: () => void openBotChat(bot),
                title: role ? `${label} — ${role}` : label,
                type: 'button',
                children: [
                  jsx('span', {
                    className: 'transition-transform group-hover:scale-[1.04]',
                    children: jsx(BotFace, { color, image, mood: 'idle', name: bot.name, shape, size: 56 })
                  }),
                  jsx('span', {
                    className: 'w-full truncate text-center text-[0.72rem] font-medium',
                    children: label
                  }),
                  role
                    ? jsx('span', {
                        className: cn(
                          'w-full truncate rounded-lg bg-(--ui-control-active-background) px-1.5 py-0.5',
                          'text-center text-[0.62rem] text-(--ui-text-tertiary)'
                        ),
                        children: role
                      })
                    : null
                ]
              })
            }),
            jsxs(ContextMenuContent, {
              children: [
                jsx(ContextMenuItem, {
                  onSelect: () => toggleBotPin(bot.name),
                  children: 'Unpin from top'
                }),
                jsx(ContextMenuItem, {
                  onSelect: () => onEdit(bot),
                  children: 'Edit Profile'
                }),
                ...deleteMenuItems(bot, onDelete)
              ]
            })
          ]
          })
        },
        bot.name
      )
    })
  })
}

/** The create affordance, sitting under the pinned shelf exactly as Grok Bot
 *  places it: a card, not a toolbar icon, because creating a teammate is a
 *  first-class action rather than chrome. */
function CreateNewRow() {
  // Grok Bot shows this only while you are composing a new chat — the "+" beside
  // search starts that draft. Standing there permanently made it chrome.
  const draft = useValue($newConversation)

  if (!draft) {
    return null
  }

  return jsx('div', {
    className: 'px-3 pb-2',
    children: jsxs('button', {
      className: cn(
        'flex w-full items-center gap-3 rounded-2xl bg-(--ui-control-active-background)/60 px-3 py-3',
        'text-left transition-colors hover:bg-(--ui-control-active-background)'
      ),
      onClick: beginNewConversation,
      type: 'button',
      children: [
        jsx('span', {
          className: cn(
            'grid size-10 shrink-0 place-items-center rounded-full',
            'bg-(--ui-control-active-background) text-(--ui-text-secondary)'
          ),
          children: jsx(Codicon, { name: 'add', size: '0.85rem' })
        }),
        jsx('span', { className: 'text-[0.86rem] font-semibold', children: 'Create new' })
      ]
    })
  })
}

/** The pane's bottom shelf. Grok Bot anchors Plugins and the account row to
 *  the bottom-left; ours carries Plugins and the model the active bot runs on,
 *  which is the setting people actually reach for. Sits below the roster and
 *  outside its scroll area, so it stays put while the list moves. */
function PaneFooter() {
  return jsxs('div', {
    className: 'shrink-0 border-t border-(--ui-stroke-secondary) px-2 py-2',
    children: [
      // Mirrors the selector row below it exactly — one footer, one row spec.
      jsxs('button', {
        className: cn(
          'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left',
          'hover:bg-(--ui-control-active-background)'
        ),
        onClick: () => {
          haptic('tap')
          host.connectors?.open?.()
        },
        type: 'button',
        children: [
          jsx('span', {
            className: cn(
              'grid size-7 shrink-0 place-items-center rounded-full',
              'bg-(--ui-control-active-background) text-(--ui-text-secondary)'
            ),
            children: jsx(Codicon, { name: 'plug', size: '0.7rem' })
          }),
          jsx('span', { className: 'text-[0.78rem] font-medium leading-4', children: 'Plugins' })
        ]
      }),
      jsx(ProviderSwitch, { variant: 'row' })
    ]
  })
}

function NewChatTitlebarButton() {
  return jsx(Tip, {
    label: 'New bot chat',
    children: jsx('button', {
      type: 'button',
      'aria-label': 'New bot chat',
      'data-hermes-bots-new-chat': '',
      className:
        'size-7 items-center justify-center rounded-lg text-(--ui-text-tertiary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground [-webkit-app-region:no-drag]',
      onClick: event => {
        event.preventDefault()
        event.stopPropagation()
        beginNewConversation()
      }
    })
  })
}

function BotModeTitlebarButtons() {
  return jsxs('div', {
    'data-hermes-bots-titlebar': '',
    className: 'flex items-center gap-1',
    children: [jsx(NewChatTitlebarButton, {})]
  })
}

function BotsPane() {
  const { data, error, isLoading, refetch } = useRoster()
  const gatewayUp = useValue(host.state.gateway) === 'open'
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deletingGroup, setDeletingGroup] = useState(null)
  const [search, setSearch] = useState('')
  const [listDropActive, setListDropActive] = useState(false)
  const draft = useValue($newConversation)
  const groups = useValue($botGroups)

  // The socket opening (boot, SSH reconnect, sleep/wake) is the signal to
  // retry immediately instead of waiting out the poll interval.
  useEffect(() => {
    if (gatewayUp) {
      void refetch()
    }
  }, [gatewayUp, refetch])
  const allMeta = $botMeta.get()
  // Messaging-app order: most recent activity first, where "activity" is
  // the newest of (bot created, last message in any of its sessions). A
  // freshly created bot tops the list until another bot gets a message.
  // No special slot for the primary bot — it competes on recency too.
  const activityOf = bot => {
    const created = allMeta[bot.name]?.created || bot.ui_meta?.['hermes-bots']?.created || 0
    const lastMsg = (bot.last_session?.last_active || 0) * 1000

    return Math.max(created, lastMsg)
  }
  // Resilience (@wesleysimplicio, #13): a failed refresh must not erase a
  // roster the user already had — mixed local+cloud gateways and remotes
  // waking from sleep fail transiently. Render the last good snapshot with
  // a notice; the full error card is reserved for "never had a roster".
  const live = Array.isArray(data?.profiles) ? data.profiles : null
  const source = filterDeletedRoster(live ?? (error ? $lastRoster.get() : []))
  const roster = source.slice().sort((a, b) => activityOf(b) - activityOf(a))

  useEffect(() => {
    if (Array.isArray(live)) {
      syncConnectorsForRoster(filterDeletedRoster(live))
    }
  }, [live])

  useEffect(() => {
    if (!Array.isArray(live)) {
      return
    }

    for (const bot of live) {
      if (!isRecentlyDeleted(bot.name) || zombieDeletesInFlight.has(bot.name)) {
        continue
      }

      const attempts = zombieDeleteAttempts.get(bot.name) || 0

      if (attempts >= 3) {
        continue
      }

      zombieDeletesInFlight.add(bot.name)
      zombieDeleteAttempts.set(bot.name, attempts + 1)
      void deleteBotProfile(bot).finally(() => zombieDeletesInFlight.delete(bot.name))
    }
  }, [live])

  if (live) {
    $lastRoster.set(roster)
    mergeServerMeta(roster)
    pullServerAvatars(roster)
    trackInboundActivity(roster)
    pruneGroupsAgainstRoster(roster)
  }

  const staleNotice =
    error && !live && roster.length
      ? 'Roster refresh failed — showing the last good list.' +
        (gatewayUp ? '' : ' Waiting for the gateway to reconnect…')
      : null
  const groupRows = Object.values(groups).sort((a, b) => (b.lastActive || b.createdAt) - (a.lastActive || a.createdAt))
  const searchNeedle = search.trim().toLowerCase()
  const visibleGroups = searchNeedle
    ? groupRows.filter(group => `${group.title} ${group.preview || ''}`.toLowerCase().includes(searchNeedle))
    : groupRows
  const visibleRoster = searchNeedle
    ? roster.filter(bot => {
        const meta = allMeta[bot.name]
        const haystack = `${displayName(bot, meta)} ${bot.name} ${bot.description || ''} ${bot.last_session?.preview || ''}`

        return haystack.toLowerCase().includes(searchNeedle)
      })
    : roster

  // Pins split the roster: the shelf owns them, the list shows the rest.
  const pinnedNames = useValue($pinnedBots)
  const pinnedRoster = pinnedNames.map(name => visibleRoster.find(bot => bot.name === name)).filter(Boolean)
  const unpinnedRoster = visibleRoster.filter(bot => !pinnedNames.includes(bot.name))

  return jsxs('div', {
    className: 'flex h-full flex-col bg-(--ui-sidebar-surface-background)',
    'data-hermes-bots-pane': '',
    children: [
      jsx('div', {
        className: 'px-2.5 pb-2.5 pt-1',
        children: jsxs('label', {
          className:
            'flex h-8 min-w-0 w-full items-center gap-1.5 border px-2.5 text-(--ui-text-quaternary)',
          style: {
            backgroundColor: 'rgba(255,255,255,0.07)',
            borderColor: 'rgba(255,255,255,0.10)',
            borderRadius: '12px'
          },
          children: [
            jsx(Codicon, { name: 'search', size: '0.75rem' }),
            jsx('input', {
              value: search,
              className:
                'min-w-0 flex-1 bg-transparent text-[0.78rem] text-foreground outline-none placeholder:text-(--ui-text-quaternary)',
              placeholder: 'Search',
              'aria-label': 'Search bots and groups',
              onChange: event => setSearch(event.target.value)
            })
          ]
        })
      }),
      staleNotice
        ? jsx('div', {
            className:
              'mx-2.5 mb-1 rounded-md bg-(--chrome-action-hover) px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
            children: staleNotice
          })
        : null,
      draft?.participantIds?.length ? jsx(ConversationDraftRow, { draft, roster }) : null,
      isLoading && !roster.length && !groupRows.length
        ? jsx('div', {
            className: 'flex flex-1 items-center justify-center',
            children: jsx(GlyphSpinner, {
              spinner: 'breathe',
              className: 'text-(--ui-text-tertiary)'
            })
          })
        : error && !roster.length && !groupRows.length
          ? jsxs('div', {
              className: 'grid gap-2 px-3 py-4 text-xs text-(--ui-text-tertiary)',
              children: [
                jsx('div', {
                  children: gatewayUp
                    ? `Roster unavailable: ${error instanceof Error ? error.message : 'gateway error'}. If your gateway predates profiles.list, update Hermes and restart the gateway.`
                    : 'Waiting for the gateway connection… (remote gateways can take a few seconds; retries automatically)'
                }),
                jsx(Button, {
                  variant: 'secondary',
                  size: 'sm',
                  className: 'justify-self-start',
                  onClick: () => void refetch(),
                  children: 'Retry now'
                })
              ]
            })
          : roster.length === 0 && groupRows.length === 0
            ? jsx(EmptyState, {
                icon: 'hubot',
                title: 'No agents yet',
                description: 'Create your first teammate.'
              })
            : jsx(ScrollArea, {
                className: cn(
                  'min-h-0 flex-1 transition-colors',
                  listDropActive && 'bg-(--ui-control-hover-background)'
                ),
                'aria-label': 'Bot conversations',
                onDragEnter: event => {
                  const overPinned =
                    event.target instanceof Element && event.target.closest('[data-hermes-bots-pinned-shelf]')

                  if (!overPinned && $pinnedBots.get().includes(readDraggedBot(event))) {
                    event.preventDefault()
                    setListDropActive(true)
                  }
                },
                onDragOver: event => {
                  const overPinned =
                    event.target instanceof Element && event.target.closest('[data-hermes-bots-pinned-shelf]')

                  if (!overPinned && $pinnedBots.get().includes(readDraggedBot(event))) {
                    event.preventDefault()
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'move'
                    }
                  }
                },
                onDragLeave: event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setListDropActive(false)
                  }
                },
                onDrop: event => {
                  const name = readDraggedBot(event)

                  if (name && $pinnedBots.get().includes(name)) {
                    event.preventDefault()
                    unpinBot(name)
                  }

                  setListDropActive(false)
                  finishBotDrag()
                },
                children: jsxs('div', {
                  className: 'pb-2',
                  children: [
                    // Pinned agents lift out of the list into the shelf, so a
                    // pin promotes rather than duplicating the row below.
                    jsx(PinnedStrip, { bots: pinnedRoster, onEdit: setEditing, onDelete: setDeleting }),
                    jsx('div', {
                      className: 'flex min-h-32 flex-col',
                      children: [
                        jsx(CreateNewRow, {}),
                        jsx('div', {
                          // grid-cols-1 = minmax(0,1fr): a bare grid's auto
                          // track sizes to MAX-content, so one long group
                          // title silently widened every row past the pane,
                          // eating the right inset and the title's ellipsis.
                          className: 'grid grid-cols-1 gap-1 px-2.5',
                          children: [
                            ...visibleGroups.map(group =>
                              jsx(BotGroupRow, { group, roster, onDelete: setDeletingGroup }, group.id)
                            ),
                            ...unpinnedRoster.map(bot =>
                              jsx(BotRow, { bot, onEdit: setEditing, onDelete: setDeleting }, bot.name)
                            )
                          ]
                        })
                      ]
                    })
                  ]
                })
              }),
      jsx(PaneFooter, {}),
      jsx(EditProfileDialog, {
        bot: editing,
        open: Boolean(editing),
        onClose: () => {
          setEditing(null)
          void refetch()
        },
        onDelete: bot => {
          setEditing(null)
          setDeleting(bot)
        }
      }),
      jsx(DeleteBotDialog, {
        bot: deleting,
        open: Boolean(deleting),
        onClose: () => {
          setDeleting(null)
          void refetch()
        }
      }),
      jsx(DeleteGroupDialog, {
        group: deletingGroup,
        open: Boolean(deletingGroup),
        onClose: () => setDeletingGroup(null)
      })
    ]
  })
}

// ── plugin ───────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Bots',
  defaultEnabled: true,
  register(ctx) {
    pluginCtx = ctx
    pluginDisposed = false

    ctx.onDispose?.(() => {
      pluginDisposed = true
      navigationIntentEpoch += 1
      navigationIntentTarget = ''

      for (const timer of canonicalKickoffs.values()) {
        window.clearTimeout(timer)
      }

      canonicalKickoffs.clear()
    })

    // Product-shell CSS lives with the direct-file plugin because those
    // classes are not part of the app's precompiled Tailwind graph. Reuse and
    // REWRITE the node on hot reload so UI iteration is immediately visible.
    let style = document.getElementById('hermes-bots-keyframes')

    if (!style) {
      style = document.createElement('style')
      style.id = 'hermes-bots-keyframes'
      document.head.appendChild(style)
    }

    style.textContent = `
        @keyframes hermes-bots-bob { from { transform: translateY(0); } to { transform: translateY(-3px); } }

        [data-hermes-bots-titlebar] {
          display: none !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-hermes-bots-titlebar] {
          display: flex !important;
          transform: translateX(-3.75rem);
        }

        [data-hermes-bots-new-chat] {
          display: flex !important;
        }

        [data-hermes-bots-new-chat]::before {
          content: '+';
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 24px;
          font-weight: 200;
          line-height: 1;
          transform: translateY(-1px);
        }

        /* Bot Mode chrome applies only while the Bots roster is the VISIBLE
           tab. Keep-alive leaves the pane mounted under [data-pane-hidden],
           and matching that used to hide the Sessions | Bots chips — trapping
           the user on Sessions with no way back. */
        [data-tree-group]:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-zone-tabstrip],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-tree-group]:has([data-composer-target]) [data-zone-tabstrip],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-slot='statusbar'] {
          display: none !important;
        }

        /* Grok-style message geometry: transcript and composer use the full
           conversation surface so user bubbles reach the right edge and bot
           bubbles stay on the left instead of clustering in a narrow column. */
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-tree-group]:has([data-composer-target]) {
          --composer-width: 100%;
        }

        /* Grok keeps message bubbles close to the conversation edges. The
           stock workspace gutter is intentionally roomier for IDE sessions,
           but makes this messenger layout look shrunken and over-inset. */
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-slot='aui_thread-content'] {
          padding-left: 0.75rem !important;
          padding-right: 0.75rem !important;
        }

        /* Message renderers contain their own markdown type scale, so changing
           only the outer bubble can leave the visible text untouched. Pin the
           complete Bot Mode bubble subtree to the intentionally tiny messenger
           scale instead of relying on inheritance through those renderers. */
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          :is(
            [data-slot='aui_user-message-bubble'],
            [data-slot='aui_assistant-message-content'],
            [data-slot='aui_bot-group-bubble'],
            [data-slot='aui_assistant-activity-root']
          ) {
          --conversation-text-font-size: 11.5px;
          font-size: 11.5px !important;
          line-height: 1.4 !important;
          padding: 0.25rem 0.5625rem !important;
          border-radius: 0.75rem !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          :is(
            [data-slot='aui_assistant-message-content'],
            [data-slot='aui_bot-group-bubble']
          )
          .aui-md {
          font-size: 11.5px !important;
          line-height: 1.4 !important;
        }

        /* Keep the iMessage-style joined corners that group replies established,
           and apply the same cluster geometry to consecutive direct-chat bot
           messages. The compact bubble override above intentionally owns the
           outer radius, so these corner-specific rules must opt back in. */
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          [data-slot='aui_bot-group-bubble'][data-cluster='first'] {
          border-bottom-left-radius: var(--conversation-bubble-cluster-radius) !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          [data-slot='aui_bot-group-bubble'][data-cluster='middle'] {
          border-top-left-radius: var(--conversation-bubble-cluster-radius) !important;
          border-bottom-left-radius: var(--conversation-bubble-cluster-radius) !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          [data-slot='aui_bot-group-bubble'][data-cluster='last'] {
          border-top-left-radius: var(--conversation-bubble-cluster-radius) !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          [data-slot='aui_turn-pair']
          > [data-slot='aui_assistant-message-root']
          + [data-slot='aui_assistant-message-root']
          [data-slot='aui_assistant-message-content'] {
          border-top-left-radius: var(--conversation-bubble-cluster-radius) !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane])
          [data-slot='aui_turn-pair']
          > [data-slot='aui_assistant-message-root']:has(+ [data-slot='aui_assistant-message-root'])
          [data-slot='aui_assistant-message-content'] {
          border-bottom-left-radius: var(--conversation-bubble-cluster-radius) !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-chat-surface] {
          --conversation-turn-gap: 0.5rem;
          --composer-control-size: 1.5rem;
          --composer-control-primary-size: 1.5rem;
          --composer-input-min-height: 1.5rem;
          --composer-surface-pad-x: 0.375rem;
          --composer-surface-pad-y: 0.25rem;
          --composer-fallback-height: 2.25rem;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-slot='composer-dock'] {
          width: calc(100% - 1.5rem) !important;
          padding-bottom: 0.625rem !important;
        }

        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-slot='composer-rich-input'] {
          font-size: 11px !important;
        }

        /* A fresh bot/group draft is intentionally quiet. Hermes's giant IDE
           onboarding wordmark fights the recipient picker and is not part of
           the Grok-style messenger hierarchy. */
        body:has([data-hermes-bot-chat-header]) [data-slot='aui_intro'] {
          visibility: hidden !important;
        }

        /* Preserve the two controls that matter in this product shell. The
           layout editor, HUD, haptics, pane flip and generic right-sidebar
           toggle belong to Hermes's workstation UI, not the bot messenger. */
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='sidebar'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='flip-panes'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='layout'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='hud'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='haptics'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) [data-titlebar-tool='right-sidebar'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Swap sidebar sides'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Layout editor'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='HUD mode'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Mute haptics'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Unmute haptics'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Show right sidebar'],
        body:has(div.absolute:not([data-pane-hidden]) [data-hermes-bots-pane]) button[aria-label='Hide right sidebar'] {
          display: none !important;
        }
      `

    // Hydrate persisted avatars/titles. Storage may be sync, async, or
    // absent depending on shell version — normalize through Promise.resolve
    // inside a try so a storage quirk can NEVER fail the plugin load.
    try {
      const hydrationRevision = botMetaRevision

      Promise.resolve(ctx.storage?.get?.('bot-meta'))
        .then(value => {
          // Session discovery/creation can save a canonical chat while this
          // asynchronous read is pending. The older snapshot must not erase
          // that id and make the next click create or adopt a different chat.
          if (value && typeof value === 'object' && botMetaRevision === hydrationRevision) {
            $botMeta.set(value)
          }
        })
        .catch(() => undefined)
    } catch {
      /* no storage on this shell — defaults stay */
    }

    try {
      const hydrationRevision = pinnedBotsRevision

      Promise.resolve(ctx.storage?.get?.(PINNED_STORAGE_KEY))
        .then(value => {
          // A first-bot pin or user drag may land while async storage is still
          // loading. Never let that older snapshot overwrite the newer intent.
          if (Array.isArray(value) && pinnedBotsRevision === hydrationRevision) {
            $pinnedBots.set(value.filter(entry => typeof entry === 'string'))
          }
        })
        .catch(() => undefined)
    } catch {
      /* no storage on this shell — nothing pinned */
    }

    try {
      Promise.resolve(ctx.storage?.get?.(GROUPS_STORAGE_KEY))
        .then(value => {
          if (value && typeof value === 'object') {
            // In-memory groups win on id collision so a late hydrate cannot
            // wipe a sessionId bound while the first turn was still streaming.
            $botGroups.set({ ...value, ...$botGroups.get() })
          }
        })
        .catch(() => undefined)
    } catch {
      /* no storage on this shell — group list starts empty */
    }

    try {
      Promise.resolve(ctx.storage?.get?.(DELETED_STORAGE_KEY))
        .then(value => {
          hydrateDeletedBots(value)
          queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
        })
        .catch(() => undefined)
    } catch {
      /* no storage on this shell — Cmd+R can restore a zombie until delete */
    }

    // Claim hidden-tab/profile navigation inside core's pre-dispatch seam.
    // This prevents the switch itself; the old post-switch snap-back flickered.
    attachBotModeKeyGate()
    ctx.onDispose?.(detachBotModeKeyGate)

    const stopProfileListener = host.state.profile.listen(profile => {
      if (profile && typeof profile === 'string') {
        if (
          botsMessengerActive() &&
          lastMessengerBot &&
          profile !== lastMessengerBot &&
          !$activeGroupId.get() &&
          !$newConversation.get()
        ) {
          return
        }

        $selectedBot.set(profile)
        if (typeof window !== 'undefined') {
          window.setTimeout(snapToCanonicalIfStray, 0)
        }
      }
    })
    ctx.onDispose?.(stopProfileListener)

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onHashChange = () => {
        window.setTimeout(snapToCanonicalIfStray, 0)
      }
      const onNewSessionShortcut = () => {
        if (!botsMessengerActive()) {
          return
        }

        beginNewConversation()
      }

      window.addEventListener('hashchange', onHashChange)
      window.addEventListener('hermes:new-session-shortcut', onNewSessionShortcut)
      window.addEventListener(FIRST_BOT_PROFILE_EVENT, onFirstBotProfile)
      ctx.onDispose?.(() => {
        window.removeEventListener('hashchange', onHashChange)
        window.removeEventListener('hermes:new-session-shortcut', onNewSessionShortcut)
        window.removeEventListener(FIRST_BOT_PROFILE_EVENT, onFirstBotProfile)
      })
    }

    // The layout tree remembers placement per pane id, and a pane that failed
    // to load gets collapsed to a rail — a state that survives reload and
    // relaunch, leaving the roster stuck behind a vertical tab. Bumping the id
    // asks the tree for a fresh default placement instead of inheriting that.
    ctx.register({
      id: 'pane-v2',
      area: 'panes',
      title: 'Bots',
      data: { placement: 'left', width: '280px' },
      render: () => jsx(BotsPane, {})
    })

    // This belongs to the real window titlebar, not the pane body. CSS anchors
    // it to the inside edge of the Bot sidebar and reveals it only while that
    // pane is active, matching Grok Bot's traffic-lights / plus composition.
    ctx.register({
      id: 'new-chat-titlebar',
      area: 'titleBar.left',
      render: () => jsx(BotModeTitlebarButtons, {})
    })

    ctx.register({
      id: 'recipients',
      area: CHAT_HEADER_AREA,
      render: () => jsx(RecipientHeader, {})
    })

    ctx.register({
      id: 'new-agent',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.new-agent`,
        label: 'New bot chat',
        keywords: ['bot', 'agent', 'profile', 'teammate', 'create', 'group'],
        run: beginNewConversation
      }
    })

    // Bind a newly submitted group draft to the durable session the core
    // composer creates. Existing groups are rebound on resume as well, so
    // background completion events can update the correct sidebar row.
    const stopSessionInfoListener = host.onEvent('session.info', event => {
      const storedId = event?.payload?.stored_session_id
      const runtimeId = event?.session_id

      if (!storedId || !runtimeId) {
        return
      }

      const activeRuntime = host.state.activeSessionId?.get?.()
      const explicitNew = pendingExplicitNewSession
      const eventProfile =
        String(event.profile || event?.payload?.profile_name || '').trim() || explicitNew?.name

      if (
        explicitNew &&
        eventProfile === explicitNew.name &&
        storedId !== explicitNew.previousChat
      ) {
        if (explicitNew.groupId) {
          patchBotGroup(explicitNew.groupId, {
            sessionId: storedId,
            lastActive: Date.now()
          })
        } else {
          saveBotMeta(explicitNew.name, { chat: storedId })
        }

        if (explicitNew.previousRuntime && explicitNew.previousChat !== storedId) {
          host
            .request('session.title', {
              session_id: explicitNew.previousRuntime,
              title: explicitNew.groupId ? 'Previous group chat' : 'Previous Bot Chat'
            })
            .catch(() => undefined)
        }

        const replacementTitle = explicitNew.groupId
          ? $botGroups.get()[explicitNew.groupId]?.title || 'Group chat'
          : CANONICAL_CHAT_TITLE
        host
          .request('session.title', {
            session_id: runtimeId,
            title: replacementTitle
          })
          .catch(() => undefined)

        pendingExplicitNewSession = null
      }

      const binding = resolveGroupSessionBinding({
        storedId,
        runtimeId,
        eventProfile: String(event.profile || '').trim(),
        activeRuntime,
        groups: $botGroups.get(),
        pendingGroupId,
        runtimeBoundGroupId: runtimeGroupIds.get(runtimeId),
        activeGroupId: $activeGroupId.get(),
        navigationTarget: navigationIntentTarget,
        isDraft: Boolean($newConversation.get())
      })

      if (binding.action === 'bind') {
        const current = $botGroups.get()[binding.groupId]
        const pin = $botMeta.get()[current?.profile]?.chat
        const retargetsCanonical = Boolean(
          pin && binding.sessionId === pin && current?.sessionId && current.sessionId !== pin
        )
        const group = retargetsCanonical
          ? current
          : current && current.sessionId === binding.sessionId
            ? current
            : patchBotGroup(binding.groupId, {
                sessionId: binding.sessionId,
                lastActive: Date.now()
              })

        if (group) {
          runtimeGroupIds.set(runtimeId, group.id)

          if (binding.clearPending) {
            pendingGroupId = null
            host
              .request('session.title', {
                session_id: runtimeId,
                title: group.title
              })
              .catch(() => undefined)
          }

          if (activeRuntime === runtimeId && !$newConversation.get()) {
            $activeGroupId.set(group.id)
          }
        }
      } else if (binding.action === 'clear') {
        // A normal session selected outside Bot Mode must not retain the last
        // group's recipient header. Only the foreground session may own it.
        $activeGroupId.set(null)
      }

      if (binding.action !== 'bind' && binding.action !== 'keep') {
        const foregroundBot = String(
          lastMessengerBot || $selectedBot.get() || host.state.profile.get() || ''
        ).trim()
        const canonical = resolveCanonicalSessionBinding({
          storedId,
          runtimeId,
          eventProfile,
          eventTitle: String(event?.payload?.title || ''),
          activeRuntime,
          trackedRuntime: liveBotRuntimes.get(eventProfile),
          pinnedId: $botMeta.get()[eventProfile]?.chat,
          routedId: routedStoredSessionId(),
          foregroundBot,
          activeGroupId: $activeGroupId.get(),
          navigationTarget: navigationIntentTarget,
          isDraft: Boolean($newConversation.get()),
          isExplicitNew: Boolean(explicitNew)
        })

        if (canonical.action === 'track' || canonical.action === 'advance') {
          liveBotRuntimes.set(canonical.profile, runtimeId)
        }

        if (canonical.action === 'advance') {
          saveBotMeta(canonical.profile, { chat: canonical.sessionId })
        }
      }
    })
    ctx.onDispose?.(stopSessionInfoListener)

    const stopMessageCompleteListener = host.onEvent('message.complete', event => {
      const groupId = runtimeGroupIds.get(event?.session_id)

      if (!groupId) {
        return
      }

      const text = String(event?.payload?.text || event?.payload?.rendered || '').trim()
      const cleanPreview = text
        .replace(/<<<HERMES_DESKTOP_BOT_GROUP_REPLY_V1[^>]*>>>/g, '')
        .replaceAll(BOT_GROUP_REPLY_END, '')
        .replace(/\s+/g, ' ')
        .trim()

      patchBotGroup(groupId, {
        lastActive: Date.now(),
        preview: cleanPreview.slice(0, 160)
      })
    })
    ctx.onDispose?.(stopMessageCompleteListener)

    // @-mention middleware: "@<bot> do the thing" in any chat becomes an
    // explicit handoff instruction the active agent's SOUL.md knows how to
    // execute. Names are validated against the LIVE roster so
    // "user@example.com" or an unknown @ passes through untouched.
    ctx.register({
      id: 'mention-middleware',
      area: COMPOSER_AREAS.middleware,
      data: {
        handler: async draft => {
          const text = draft.text || ''

          const pendingDraft = $newConversation.get()
          let activeGroup = $activeGroupId.get() ? $botGroups.get()[$activeGroupId.get()] : null

          if (pendingDraft) {
            if (pendingDraft.participantIds.length === 0) {
              host.notify({
                kind: 'info',
                message: 'Choose at least one bot first.'
              })

              return null
            }

            if (pendingDraft.participantIds.length === 1) {
              $newConversation.set(null)

              return draft
            }

            activeGroup = createOrActivateDraftGroup(pendingDraft, $lastRoster.get())
          }

          if (activeGroup && activeGroup.participantIds.length > 1) {
            patchBotGroup(activeGroup.id, {
              lastActive: Date.now(),
              preview: text.replace(/\s+/g, ' ').trim().slice(0, 160)
            })

            return {
              ...draft,
              text: text + '\n\n' + groupRoutingEnvelope(activeGroup, text, $lastRoster.get())
            }
          }

          if (!/(^|\s)@[a-z0-9][a-z0-9_-]*/i.test(text)) {
            return draft
          }

          let names = []
          try {
            const res = await host.request('profiles.list', {
              include_sessions: false
            })
            names = (res?.profiles ?? []).map(p => p.name)
          } catch {
            return draft
          }

          // Mentions in code are code, not handoffs (#20).
          const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
          const active = (host.state.profile.get() || 'default').trim() || 'default'
          const mentioned = []

          for (const match of prose.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]*)/gi)) {
            let name = match[2].toLowerCase()

            if (name === 'hermes' && !names.includes('hermes') && names.includes('default')) {
              name = 'default'
            }

            if (names.includes(name) && name !== active && !mentioned.includes(name)) {
              mentioned.push(name)
            }
          }

          if (!mentioned.length) {
            return draft
          }

          // The ACTIVE BOT composes the message — it understands intent; a
          // text pipe never can. Delivery is the one blessed command into the
          // recipient's canonical Bot Chat, so their side reads as a normal
          // DM (message bubble + their reply), and the reply prints on
          // stdout for the sender to relay.
          const activeMeta = $botMeta.get()[active]
          const senderName = displayName({ name: active, title: activeMeta?.title }, activeMeta)
          const note =
            '\n\n[@mention handoff — for each mentioned agent (' +
            mentioned.map(botHandle).join(', ') +
            '): ' +
            'COMPOSE a message from you (' +
            senderName +
            ') to that agent conveying what the user wants — do not forward this text verbatim. Send it with exactly one command:\n' +
            mentioned
              .map(
                n =>
                  '`hermes -p ' +
                  n +
                  ' chat -c "Bot Chat" -Q -q "Message from \uD83E\uDD16 ' +
                  senderName +
                  ' (@' +
                  botHandle(active) +
                  '): <your composed message>"`'
              )
              .join('\n') +
            '\nIf it fails with "No session found matching \'Bot Chat\'", send once without the -c flag, then run `hermes -p <agent> sessions rename <session_id from the output> "Bot Chat"`. ' +
            'Relay the reply back to the user, attributed to that agent.]'

          return { ...draft, text: text + note }
        }
      }
    })
  }
}
