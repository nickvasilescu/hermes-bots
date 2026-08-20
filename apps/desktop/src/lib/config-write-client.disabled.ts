import type { HermesConfigRecord } from '@/types/hermes'

interface ProfileScoped {
  profile?: string
}

export function saveHermesConfigForSku(
  _config: HermesConfigRecord,
  _profile: null | string | undefined,
  _profileScope: (profile?: null | string) => ProfileScoped
): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: false })
}
