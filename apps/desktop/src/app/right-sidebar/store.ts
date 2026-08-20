import { atom } from 'nanostores'

import { isBotProduct } from '@/lib/product'
import { allowsDesktopCapability } from '@/lib/product-capabilities'
import { persistBoolean, storedBoolean } from '@/lib/storage'

const TAKEOVER_KEY = 'hermes.desktop.terminalTakeover'
const ORGO_DESKTOP_OPEN_KEY = 'hermes.desktop.orgoDesktop.open.v1'
const ORGO_DESKTOP_ALLOWED = allowsDesktopCapability('allowOrgo')

export const $terminalTakeover = atom(storedBoolean(TAKEOVER_KEY, false))

$terminalTakeover.subscribe(active => persistBoolean(TAKEOVER_KEY, active))

export const setTerminalTakeover = (active: boolean) => $terminalTakeover.set(active)

export const $orgoDesktopOpen = atom(
  ORGO_DESKTOP_ALLOWED ? storedBoolean(ORGO_DESKTOP_OPEN_KEY, isBotProduct()) : false
)

$orgoDesktopOpen.subscribe(active => {
  if (ORGO_DESKTOP_ALLOWED) {
    persistBoolean(ORGO_DESKTOP_OPEN_KEY, active)
  }
})

export const setOrgoDesktopOpen = (active: boolean) => $orgoDesktopOpen.set(ORGO_DESKTOP_ALLOWED && active)

/** Raised when something outside the pane asks to configure the computer —
 *  the titlebar gear. The pane consumes and clears it, so a request made
 *  while the pane is closed still lands once it mounts. */
export const $orgoDesktopSettingsRequest = atom(false)

export const requestOrgoDesktopSettings = () => {
  if (!ORGO_DESKTOP_ALLOWED) {
    return
  }

  setOrgoDesktopOpen(true)
  $orgoDesktopSettingsRequest.set(true)
}

export const clearOrgoDesktopSettingsRequest = () => $orgoDesktopSettingsRequest.set(false)

/** A command queued to run in the embedded terminal. The terminal pane flushes
 *  (and clears) it once its session is live, so a value set before the pane
 *  mounts still runs. Cleared after flush so a later remount can't replay it. */
export const $terminalInjection = atom<null | string>(null)

/** Open the terminal pane and run a command in it. Used to disconnect external
 *  (CLI-managed) providers, which Hermes can't clear via the API — the user
 *  sees exactly what runs instead of Hermes silently deleting their creds. */
export const runInTerminal = (command: string) => {
  const trimmed = command.trim()

  if (!trimmed) {
    return
  }

  setTerminalTakeover(true)
  $terminalInjection.set(trimmed)
}
