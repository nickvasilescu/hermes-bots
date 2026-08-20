import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface WebviewPolicy {
  allowedFileRoots?: readonly string[]
  isTrustedParentUrl: (url: string) => boolean
}

export interface WebviewAttachmentInput {
  parentIsTopLevel: boolean
  parentUrl: string
  src: unknown
  webPreferences: Record<string, unknown>
}

export type WebviewAttachmentDecision =
  | { allow: false; reason: string }
  | { allow: true; webPreferences: Record<string, unknown> }

function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isAllowedSource(raw: unknown, allowedFileRoots: readonly string[]): boolean {
  if (typeof raw !== 'string' || !raw) {
    return false
  }

  try {
    const url = new URL(raw)

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return !url.username && !url.password
    }

    if (url.protocol !== 'file:') {
      return false
    }

    const filePath = fileURLToPath(url)

    return allowedFileRoots.some(root => isPathWithin(filePath, root))
  } catch {
    return false
  }
}

export function decideWebviewAttachment(
  input: WebviewAttachmentInput,
  policy: WebviewPolicy
): WebviewAttachmentDecision {
  if (!input.parentIsTopLevel || !policy.isTrustedParentUrl(input.parentUrl)) {
    return { allow: false, reason: 'untrusted-parent' }
  }

  if (!isAllowedSource(input.src, policy.allowedFileRoots ?? [])) {
    return { allow: false, reason: 'untrusted-source' }
  }

  return {
    allow: true,
    webPreferences: {
      ...input.webPreferences,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      partition: undefined,
      preload: undefined,
      preloadURL: undefined,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  }
}
