import { capitalize } from '@/lib/text'

export type MediaKind = 'audio' | 'image' | 'video' | 'file'

const EXT_KIND: Record<string, MediaKind> = {
  avi: 'video',
  bmp: 'image',
  flac: 'audio',
  gif: 'image',
  jpeg: 'image',
  jpg: 'image',
  m4a: 'audio',
  mkv: 'video',
  mov: 'video',
  mp3: 'audio',
  mp4: 'video',
  ogg: 'audio',
  opus: 'audio',
  png: 'image',
  svg: 'image',
  wav: 'audio',
  webm: 'video',
  webp: 'image'
}

export function mediaKind(path: string): MediaKind {
  const ext = path.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase() ?? ''

  return EXT_KIND[ext] ?? 'file'
}

export function mediaMime(path: string): string {
  const kind = mediaKind(path)

  return kind === 'image'
    ? 'image/*'
    : kind === 'audio'
      ? 'audio/*'
      : kind === 'video'
        ? 'video/*'
        : 'application/octet-stream'
}

export function mediaName(path: string): string {
  try {
    return new URL(path).pathname.split('/').filter(Boolean).pop() || path
  } catch {
    return path.split(/[\\/]/).filter(Boolean).pop() || path
  }
}

export function mediaMarkdownHref(path: string): string {
  return `#media:${encodeURIComponent(path)}`
}

export function isInlineMediaSrc(path: string): boolean {
  return /^(?:https?|data):/i.test(path)
}

export async function resolveMediaDisplaySrc(path: string): Promise<string> {
  return isInlineMediaSrc(path) ? path : ''
}

export const resolveMediaPlaybackSrc = resolveMediaDisplaySrc

export function mediaExternalUrl(path: string): string {
  return /^https?:/i.test(path) ? path : ''
}

export function mediaStreamUrl(_path: string): string {
  return ''
}

export function mediaPathFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#media:')) {
    return null
  }

  try {
    return decodeURIComponent(href.slice(7))
  } catch {
    return null
  }
}

export function filePathFromMediaPath(path: string): string {
  return path
}

export function isRemoteGateway(): boolean {
  return true
}

export async function gatewayMediaDataUrl(_path: string): Promise<string> {
  throw new Error('Path media is unavailable in the SSH-only client')
}

export async function downloadGatewayMediaFile(_path: string): Promise<void> {}

export function mediaDisplayLabel(path: string): string {
  return `${capitalize(mediaKind(path))}: ${mediaName(path).replace(/[[\]\\]/g, '\\$&')}`
}
