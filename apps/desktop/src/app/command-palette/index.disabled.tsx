import { useStore } from '@nanostores/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useNavigate } from 'react-router'

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useI18n } from '@/i18n'
import { MessageCircle, Palette, Settings } from '@/lib/icons'
import { $commandPaletteOpen, closeCommandPalette, setCommandPaletteOpen } from '@/store/command-palette'
import { useTheme } from '@/themes/context'

import { COMMAND_CENTER_ROUTE, SETTINGS_ROUTE } from '../routes'

export function CommandPalette() {
  const { t } = useI18n()
  const open = useStore($commandPaletteOpen)
  const navigate = useNavigate()
  const { availableThemes, setTheme } = useTheme()

  const run = (action: () => void) => {
    action()
    closeCommandPalette()
  }

  return (
    <DialogPrimitive.Root onOpenChange={setCommandPaletteOpen} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-100 bg-black/25" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[18%] z-101 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl">
          <DialogPrimitive.Title className="sr-only">{t.commandCenter.paletteTitle}</DialogPrimitive.Title>
          <Command loop>
            <CommandInput placeholder={t.commandCenter.searchPlaceholder} />
            <CommandList className="max-h-[min(22rem,60vh)]">
              <CommandGroup heading={t.commandCenter.nav.newChat.title}>
                <CommandItem
                  onSelect={() => run(() => window.dispatchEvent(new CustomEvent('hermes:new-session-shortcut')))}
                >
                  <MessageCircle className="size-4" />
                  New session
                </CommandItem>
                <CommandItem onSelect={() => run(() => navigate(`${COMMAND_CENTER_ROUTE}?section=sessions`))}>
                  <MessageCircle className="size-4" />
                  {t.commandCenter.sections.sessions}
                </CommandItem>
              </CommandGroup>

              <CommandGroup heading={t.commandCenter.appearance}>
                {availableThemes.map(theme => (
                  <CommandItem key={theme.name} onSelect={() => run(() => setTheme(theme.name))} value={theme.label}>
                    <Palette className="size-4" />
                    {theme.label}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading={t.commandCenter.settings}>
                <CommandItem onSelect={() => run(() => navigate(SETTINGS_ROUTE))}>
                  <Settings className="size-4" />
                  {t.commandCenter.settings}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
