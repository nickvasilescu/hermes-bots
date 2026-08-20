import { atom } from 'nanostores'

export const $orgoDesktopOpen = atom(false)
export const $orgoDesktopSettingsRequest = atom(false)

export const setOrgoDesktopOpen = (_active: boolean) => {}

export const requestOrgoDesktopSettings = () => {}

export const clearOrgoDesktopSettingsRequest = () => {}
