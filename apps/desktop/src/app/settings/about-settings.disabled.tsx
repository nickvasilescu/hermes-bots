import { useEffect, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'

import { SettingsContent } from './primitives'

/** Version and release information only. Updates and local-data removal do not
 * belong to the SSH client and therefore are absent from this module graph. */
export function AboutSettings() {
  const { t } = useI18n()
  const copy = t.settings.about
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop
      ?.getVersion?.()
      .then(info => {
        if (!cancelled) {setVersion(info.appVersion)}
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsContent>
      <div className="flex flex-col items-center gap-3 pt-6 pb-2 text-center">
        <BrandMark className="size-16" />
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{copy.heading}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {version ? copy.version(version) : copy.versionUnavailable}
          </p>
        </div>
      </div>
    </SettingsContent>
  )
}
