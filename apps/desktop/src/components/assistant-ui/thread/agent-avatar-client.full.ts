import { $gateway } from '@/store/gateway'

export interface AgentAvatarProfile {
  image: null | string
  name: string
  ui_meta?: Record<string, unknown>
}

export async function resolveAgentAvatarProfile(handle: string): Promise<AgentAvatarProfile | null> {
  const gateway = $gateway.get()

  if (!gateway) {
    return null
  }

  const res = await gateway.request<{
    profiles?: Array<{ has_avatar?: boolean; name: string; ui_meta?: Record<string, unknown> }>
  }>('profiles.list', { include_sessions: false })

  const profiles = res?.profiles ?? []
  let profile = profiles.find(candidate => candidate.name.toLowerCase() === handle)

  if (!profile && handle === 'hermes') {
    profile = profiles.find(candidate => candidate.name === 'default')
  }

  if (!profile) {
    return null
  }

  let image: null | string = null

  if (profile.has_avatar) {
    const asset = await gateway.request<{ data?: string; found?: boolean }>('profiles.get_asset', {
      asset: 'avatar',
      name: profile.name
    })

    image = asset?.found && asset.data ? asset.data : null
  }

  return { image, name: profile.name, ui_meta: profile.ui_meta }
}
