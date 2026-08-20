import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const KEY = 'hermes.desktop.reactions.v1'

export const $reactionsEnabled = atom<boolean>(typeof window === 'undefined' ? false : storedString(KEY) === 'on')

/** SSH keeps this presentation preference local and never writes Mini config. */
export function setReactionsEnabled(enabled: boolean): void {
  $reactionsEnabled.set(enabled)

  if (typeof window !== 'undefined') {
    persistString(KEY, enabled ? 'on' : 'off')
  }
}
