import { connectionScopeKey, normalizeSshConfig, savedProfileSsh } from './connection-config'
import { assertSshOnlyConnectionMode } from './ssh-only-policy'

type StoredConnectionConfig = {
  mode?: unknown
  profiles?: Record<string, any>
  remote?: any
}

type BuildSshBlock = (input: any, existingBlock?: any) => any

/** Renderer-facing SSH config deliberately contains no gateway credential or legacy remote fields. */
export function sanitizeSshOnlyDesktopConnectionConfig(config: StoredConnectionConfig = {}, profile: unknown = null) {
  const key = connectionScopeKey(profile)
  const scoped = key ? config.profiles?.[key] || null : null
  const savedMode = key ? scoped?.mode : config.mode
  const block = key ? scoped || {} : config.remote || {}

  const ssh =
    savedMode === 'ssh'
      ? normalizeSshConfig(block)
      : savedMode === 'local'
        ? key
          ? savedProfileSsh(config, key)
          : normalizeSshConfig(block)
        : null

  return {
    mode: savedMode === 'ssh' ? 'ssh' : 'local',
    profile: key,
    sshHost: ssh?.host || '',
    sshUser: ssh?.user || '',
    sshPort: ssh?.port || null,
    sshKeyPath: ssh?.keyPath || '',
    sshRemoteHermesPath: ssh?.remoteHermesPath || '',
    sshRemoteProfile: ssh?.remoteProfile || '',
    envOverride: false
  }
}

/**
 * Coerce SSH input before the full-product token path can inspect, decrypt, or
 * persist any legacy remote credential fields supplied by a renderer.
 */
export function coerceSshOnlyDesktopConnectionConfig(
  input: any,
  existing: StoredConnectionConfig,
  buildSshBlock: BuildSshBlock
) {
  const mode = String(input?.mode || '')

  assertSshOnlyConnectionMode(mode)

  const key = connectionScopeKey(input?.profile)
  const rawExistingBlock = key ? existing.profiles?.[key] || {} : existing.remote || {}
  const sshBlock = buildSshBlock(input, savedProfileSsh(existing, key) || rawExistingBlock)

  if (key) {
    return {
      mode: existing.mode === 'ssh' ? 'ssh' : 'local',
      remote: existing.remote || {},
      profiles: { ...(existing.profiles || {}), [key]: sshBlock }
    }
  }

  return { mode: 'ssh', remote: sshBlock, profiles: existing.profiles || {} }
}
