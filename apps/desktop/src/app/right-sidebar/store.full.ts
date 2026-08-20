import { atom } from 'nanostores'

import { isBotProduct } from '@/lib/product'
import { allowsDesktopCapability } from '@/lib/product-capabilities'
import { persistBoolean, storedBoolean } from '@/lib/storage'

const OPEN_KEY = 'hermes.desktop.orgoDesktop.open.v1'
const ALLOWED = allowsDesktopCapability('allowOrgo')

export const $orgoDesktopOpen = atom(ALLOWED ? storedBoolean(OPEN_KEY, isBotProduct()) : false)

$orgoDesktopOpen.subscribe(active => {
  if (ALLOWED) {
    persistBoolean(OPEN_KEY, active)
  }
})

export const setOrgoDesktopOpen = (active: boolean) => $orgoDesktopOpen.set(ALLOWED && active)
export const $orgoDesktopSettingsRequest = atom(false)

export const requestOrgoDesktopSettings = () => {
  if (!ALLOWED) {
    return
  }

  setOrgoDesktopOpen(true)
  $orgoDesktopSettingsRequest.set(true)
}

export const clearOrgoDesktopSettingsRequest = () => $orgoDesktopSettingsRequest.set(false)
