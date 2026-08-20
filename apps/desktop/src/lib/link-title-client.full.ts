import { useEffect, useMemo, useState } from 'react'

const titleCache = new Map<string, string>()
const titleInflight = new Map<string, Promise<string>>()
const titleSubs = new Map<string, Set<(value: string) => void>>()
const DOMAIN_RE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i
const SKIP_PROTO_RE = /^(?:file|data|mailto|javascript|blob|chrome|about|hermes):/i
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i
const ERROR_TITLE_RE =
  /\b(?:access denied|attention required|captcha|error|forbidden|just a moment|not found|request blocked|too many requests)\b/i

function normalizeUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return DOMAIN_RE.test(trimmed) ? `https://${trimmed}` : trimmed
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(normalizeUrl(value))
  } catch {
    return null
  }
}

function titleCacheKey(value: string): string {
  const url = parseUrl(value)

  if (!url) {
    return normalizeUrl(value)
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '') || '/'

  return `${host}${pathname}${url.search || ''}`
}

export function isTitleFetchable(value: string): boolean {
  if (!value || SKIP_PROTO_RE.test(value)) {
    return false
  }

  const url = parseUrl(value)

  return Boolean(url && /^https?:$/.test(url.protocol) && !LOCAL_HOST_RE.test(url.host))
}

export function fetchLinkTitle(url: string): Promise<string> {
  const normalizedUrl = normalizeUrl(url)
  const key = titleCacheKey(normalizedUrl)

  if (!isTitleFetchable(normalizedUrl)) {
    return Promise.resolve('')
  }

  if (titleCache.has(key)) {
    return Promise.resolve(titleCache.get(key) ?? '')
  }

  const pending = titleInflight.get(key)

  if (pending) {
    return pending
  }

  const bridge = typeof window === 'undefined' ? undefined : window.hermesDesktop?.fetchLinkTitle

  if (!bridge) {
    titleCache.set(key, '')

    return Promise.resolve('')
  }

  const promise = bridge(normalizedUrl)
    .then(value => (value || '').replace(/\s+/g, ' ').trim())
    .then(clean => (clean && !ERROR_TITLE_RE.test(clean) ? clean : ''))
    .catch(() => '')
    .then(safe => {
      titleCache.set(key, safe)
      titleInflight.delete(key)
      titleSubs.get(key)?.forEach(sub => sub(safe))

      return safe
    })

  titleInflight.set(key, promise)

  return promise
}

export function useLinkTitle(url?: null | string): string {
  const normalizedUrl = useMemo(() => (url ? normalizeUrl(url) : ''), [url])
  const key = useMemo(() => (normalizedUrl ? titleCacheKey(normalizedUrl) : ''), [normalizedUrl])
  const [title, setTitle] = useState(() => (key ? (titleCache.get(key) ?? '') : ''))

  useEffect(() => {
    setTitle(key ? (titleCache.get(key) ?? '') : '')

    if (!key || !isTitleFetchable(normalizedUrl)) {
      return
    }

    const subs = titleSubs.get(key) ?? new Set<(value: string) => void>()

    subs.add(setTitle)
    titleSubs.set(key, subs)
    void fetchLinkTitle(normalizedUrl)

    return () => {
      subs.delete(setTitle)

      if (!subs.size) {
        titleSubs.delete(key)
      }
    }
  }, [key, normalizedUrl])

  return title
}

export function resetLinkTitleCache(): void {
  titleCache.clear()
  titleInflight.clear()
  titleSubs.clear()
}
