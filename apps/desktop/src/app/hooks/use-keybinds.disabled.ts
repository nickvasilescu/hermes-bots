import { useEffect } from 'react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { toggleCommandPalette } from '@/store/command-palette'

export interface KeybindRuntimeDeps {
  openNewSessionTab: () => void
  startFreshSession: () => void
  toggleCommandCenter: () => void
  toggleSelectedPin: () => void
}

export function useKeybinds(deps: KeybindRuntimeDeps): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey

      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggleCommandPalette()
      } else if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        deps.startFreshSession()
      } else if (!command && event.key === '/' && event.target === document.body) {
        event.preventDefault()
        requestComposerFocus('active', { typeChar: '/' })
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deps])
}
