import { useEffect, useState } from 'react'

import { FirstRunSshForm } from './first-run-ssh-form'

/** First-run surface for the constrained build. It discovers only whether an
 * SSH record exists and otherwise presents the fixed SSH form; no bootstrap,
 * remote-token, OAuth, or local-runtime module is reachable from this entry. */
export function DesktopInstallOverlay({ enabled = true }: { enabled?: boolean }) {
  const [needsConnection, setNeedsConnection] = useState(false)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    const desktop = window.hermesDesktop

    if (!desktop?.getConnectionConfig) {
      setNeedsConnection(true)

      return
    }

    void desktop
      .getConnectionConfig()
      .then(config => {
        if (!cancelled) {
          setNeedsConnection(config.mode !== 'ssh')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNeedsConnection(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return enabled && needsConnection ? <FirstRunSshForm /> : null
}
