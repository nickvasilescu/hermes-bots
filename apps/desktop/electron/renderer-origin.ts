import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RendererOriginPolicy {
  devServerUrl?: string
  isPackaged: boolean
  packagedRendererUrl?: string
  rendererEntryPath: string
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)

    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  return normalize(left) === normalize(right)
}

export function isTrustedRendererUrl(rawUrl: unknown, policy: RendererOriginPolicy): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return false
  }

  let candidate: URL

  try {
    candidate = new URL(rawUrl)
  } catch {
    return false
  }

  if (candidate.username || candidate.password) {
    return false
  }

  if (policy.isPackaged) {
    if (policy.packagedRendererUrl) {
      try {
        const trusted = new URL(policy.packagedRendererUrl)

        return (
          candidate.protocol === trusted.protocol &&
          candidate.hostname === trusted.hostname &&
          candidate.port === trusted.port &&
          candidate.pathname === trusted.pathname
        )
      } catch {
        return false
      }
    }

    if (candidate.protocol !== 'file:' || (candidate.hostname && candidate.hostname !== 'localhost')) {
      return false
    }

    try {
      return samePath(fileURLToPath(candidate), policy.rendererEntryPath)
    } catch {
      return false
    }
  }

  if (!policy.devServerUrl) {
    return false
  }

  try {
    const devServer = new URL(policy.devServerUrl)

    return (
      candidate.origin === devServer.origin &&
      (candidate.pathname === devServer.pathname || candidate.pathname === `${devServer.pathname.replace(/\/$/, '')}/`)
    )
  } catch {
    return false
  }
}

export function isTrustedTopLevelFrame(
  frame: { top?: unknown; url?: string } | null | undefined,
  policy: RendererOriginPolicy
): boolean {
  return Boolean(frame && frame.top === frame && isTrustedRendererUrl(frame.url, policy))
}
