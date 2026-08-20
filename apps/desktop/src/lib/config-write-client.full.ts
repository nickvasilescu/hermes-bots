import type { HermesConfigRecord } from '@/types/hermes'

interface ProfileScoped {
  profile?: string
}

export function saveHermesConfigForSku(
  config: HermesConfigRecord,
  profile: null | string | undefined,
  profileScope: (profile?: null | string) => ProfileScoped
): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    ...profileScope(profile),
    path: '/api/config',
    method: 'PUT',
    body: { config }
  })
}
