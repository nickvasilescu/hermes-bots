import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useI18n } from '@/i18n'
import { Archive, Bell, Info, Keyboard, Palette } from '@/lib/icons'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { OverlayMain, OverlayNav, type OverlayNavGroup, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'

import { AboutSettings } from './about-settings'
import { AppearanceSettings } from './appearance-settings'
import { KeybindSettings } from './keybind-settings'
import { NotificationsSettings } from './notifications-settings'
import { SessionsSettings } from './sessions-settings'
import type { SettingsPageProps, SettingsView as SettingsViewId } from './types'

const SSH_ONLY_SETTINGS_VIEWS: readonly SettingsViewId[] = [
  'config:appearance',
  'keybinds',
  'notifications',
  'sessions',
  'about'
]

export function settingsViewsForProduct(_sshOnly: boolean): readonly SettingsViewId[] {
  return SSH_ONLY_SETTINGS_VIEWS
}

export function resolveSettingsView(raw: string | null, _sshOnly: boolean): SettingsViewId {
  return raw && SSH_ONLY_SETTINGS_VIEWS.includes(raw as SettingsViewId) ? (raw as SettingsViewId) : 'config:appearance'
}

/** A separate settings entrypoint for the compiled SSH SKU. Keeping this file
 * independent of the full settings router is intentional: provider, key,
 * gateway-token, connector, and local-runtime panels never enter its graph. */
export function SettingsView({ onClose }: SettingsPageProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { hash, pathname, search } = useLocation()

  const [activeView, setActiveView] = useRouteEnumParam('tab', SSH_ONLY_SETTINGS_VIEWS, 'config:appearance')

  useEffect(() => {
    const params = new URLSearchParams(search)
    const requested = params.get('tab')

    if (!requested || SSH_ONLY_SETTINGS_VIEWS.includes(requested as SettingsViewId)) {
      return
    }

    for (const key of ['tab', 'pview', 'kview', 'field', 'server']) {
      params.delete(key)
    }

    const query = params.toString()
    navigate({ hash, pathname, search: query ? `?${query}` : '' }, { replace: true })
  }, [hash, navigate, pathname, search])

  const navGroups: OverlayNavGroup[] = useMemo(
    () => [
      {
        active: activeView === 'config:appearance',
        icon: Palette,
        id: 'config:appearance',
        label: t.settings.sections.appearance,
        onSelect: () => setActiveView('config:appearance')
      },
      {
        active: activeView === 'notifications',
        icon: Bell,
        id: 'notifications',
        label: t.settings.nav.notifications,
        onSelect: () => setActiveView('notifications')
      },
      {
        active: activeView === 'keybinds',
        icon: Keyboard,
        id: 'keybinds',
        label: t.settings.nav.keybinds,
        onSelect: () => setActiveView('keybinds')
      },
      {
        active: activeView === 'sessions',
        icon: Archive,
        id: 'sessions',
        label: t.settings.nav.archivedChats,
        onSelect: () => setActiveView('sessions')
      },
      {
        active: activeView === 'about',
        gapBefore: true,
        icon: Info,
        id: 'about',
        label: t.settings.nav.about,
        onSelect: () => setActiveView('about')
      }
    ],
    [activeView, setActiveView, t]
  )

  return (
    <OverlayView closeLabel={t.settings.closeSettings} onClose={onClose}>
      <OverlaySplitLayout>
        <OverlayNav groups={navGroups} />
        <OverlayMain className="px-0 pb-0">
          {activeView === 'about' ? (
            <AboutSettings />
          ) : activeView === 'keybinds' ? (
            <KeybindSettings />
          ) : activeView === 'notifications' ? (
            <NotificationsSettings />
          ) : activeView === 'sessions' ? (
            <SessionsSettings />
          ) : (
            <AppearanceSettings />
          )}
        </OverlayMain>
      </OverlaySplitLayout>
    </OverlayView>
  )
}

export { SettingsView as SettingsPage }
