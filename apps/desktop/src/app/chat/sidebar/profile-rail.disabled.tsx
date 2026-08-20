import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { $activeGatewayProfile, $profiles, normalizeProfileKey, refreshProfiles, selectProfile } from '@/store/profile'

export function ProfileRail() {
  const { t } = useI18n()
  const profiles = useStore($profiles)
  const active = normalizeProfileKey(useStore($activeGatewayProfile))

  useEffect(() => {
    void refreshProfiles().catch(() => undefined)
  }, [])

  if (profiles.length <= 1) {
    return null
  }

  return (
    <div aria-label={t.profiles.title} className="flex min-w-0 items-center gap-1 overflow-x-auto px-2 py-1">
      {profiles.map(profile => {
        const key = normalizeProfileKey(profile.name)

        return (
          <Button
            aria-pressed={key === active}
            key={key}
            onClick={() => selectProfile(key)}
            size="xs"
            type="button"
            variant={key === active ? 'secondary' : 'ghost'}
          >
            {profile.name}
          </Button>
        )
      })}
    </div>
  )
}
