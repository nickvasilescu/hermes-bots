import type { ComponentProps, ReactNode } from 'react'
import { useMemo } from 'react'

import { ArrowUpRight } from '@/lib/icons'

import { resolveBrandIcon } from './brand-icon'
import {
  fetchLinkTitle,
  isTitleFetchable,
  resetLinkTitleCache,
  useLinkTitle
} from '@desktop/link-title-client'
import { cn } from './utils'

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)]|[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?:\/[^\s<>"'`.,;:!?)]*)?/gi

// Explicit-scheme / www. URLs only — no bare-domain matching. Used where the
// surrounding text is full of filename-shaped tokens (e.g. `agent.log`,
// `errors.log` in a /debug report) that the bare-domain branch of URL_RE would
// otherwise mistake for domains and linkify.
const EXPLICIT_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)]/gi

const DOMAIN_RE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i

export function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return DOMAIN_RE.test(trimmed) ? `https://${trimmed}` : trimmed
}

function parseUrl(value: string): null | URL {
  try {
    return new URL(normalizeExternalUrl(value))
  } catch {
    return null
  }
}

export function shortHostLabel(value: string): string {
  return parseUrl(value)?.hostname.replace(/^www\./, '') ?? value
}

export function hostPathLabel(value: string): string {
  const url = parseUrl(value)

  if (!url) {
    return value
  }

  const host = url.hostname.replace(/^www\./, '')
  const path = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : ''

  return `${host}${path}`
}

function cleanSlug(segment: string): string {
  try {
    return decodeURIComponent(segment)
      .replace(/\.a\d+\..*$/i, '')
      .replace(/\.(?:html?|php|aspx?)$/i, '')
      .replace(/(?:[-_.](?:[a-z]{1,3}\d{2,}|i\d{2,}))+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

export function urlSlugTitleLabel(value: string): string {
  const url = parseUrl(value)

  for (const segment of url?.pathname.split('/').filter(Boolean).reverse() ?? []) {
    const cleaned = cleanSlug(segment)

    if (!cleaned || !/[a-z]/i.test(cleaned)) {
      continue
    }

    if (/^(?:[a-z]{1,3}\d+|\d+)$/i.test(cleaned.replace(/\s+/g, ''))) {
      continue
    }

    const titled = cleaned.replace(/\b[a-z]/g, c => c.toUpperCase())

    if (titled.length >= 4) {
      return titled
    }
  }

  return hostPathLabel(value)
}

export { fetchLinkTitle, isTitleFetchable, useLinkTitle }

export function openExternalLink(href: string): void {
  if (href) {
    void window.hermesDesktop?.openExternal?.(href)
  }
}

interface ExternalLinkProps extends Omit<ComponentProps<'a'>, 'href' | 'target'> {
  href: string
  children?: ReactNode
  showExternalIcon?: boolean
}

export function ExternalLinkIcon({ className }: { className?: string }) {
  return <ArrowUpRight aria-hidden className={cn('ml-1 inline size-[0.78em] align-[-0.08em] opacity-70', className)} />
}

// Brand mark for a known host, sized in `em` so it tracks the surrounding text
// at any font size. It paints in `currentColor` rather than the brand hex —
// several brand colors (GitHub's near-black, Unity's white) vanish against one
// theme or the other.
//
// `title=""` is load-bearing: Simple Icons always renders a <title> defaulting
// to the brand name, which lands in the anchor's textContent and accessible
// name — a PR link would read "GitHub#123".
export function LinkBrandIcon({ className, href }: { className?: string; href: string }) {
  const Icon = resolveBrandIcon(shortHostLabel(href))

  return Icon ? (
    <Icon aria-hidden className={cn('mr-1 inline size-[0.85em] align-[-0.12em] opacity-80', className)} title="" />
  ) : null
}

export function ExternalLink({
  children,
  className,
  href,
  onClick,
  showExternalIcon = false,
  ...rest
}: ExternalLinkProps) {
  const target = normalizeExternalUrl(href)

  return (
    <a
      className={cn('ref', className)}
      href={target}
      onClick={event => {
        event.stopPropagation()
        onClick?.(event)

        if (event.defaultPrevented) {
          return
        }

        event.preventDefault()
        openExternalLink(target)
      }}
      rel="noopener noreferrer"
      target="_blank"
      {...rest}
    >
      {children ?? urlSlugTitleLabel(target)}
      {showExternalIcon && <ExternalLinkIcon />}
    </a>
  )
}

interface PrettyLinkProps extends Omit<ComponentProps<'a'>, 'href' | 'target'> {
  href: string
  label?: string
  fallbackLabel?: string
}

// Title resolution is a fallback, not an override. Both props carry authored
// text — chat markdown passes `fallbackLabel` — so either one skips the fetch.
export function PrettyLink({ className, fallbackLabel, href, label, ...rest }: PrettyLinkProps) {
  const target = useMemo(() => normalizeExternalUrl(href), [href])
  const authoredLabel = label?.trim() || fallbackLabel?.trim()
  const fetched = useLinkTitle(authoredLabel ? null : target)
  const display = authoredLabel || fetched || urlSlugTitleLabel(target)

  return (
    <ExternalLink className={cn('wrap-break-word', className)} href={target} title={target} {...rest}>
      <LinkBrandIcon href={target} />
      {display}
    </ExternalLink>
  )
}

interface LinkifiedTextProps {
  className?: string
  text: string
  pretty?: boolean
  explicitOnly?: boolean
}

export function LinkifiedText({ className, explicitOnly = false, pretty = true, text }: LinkifiedTextProps) {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(explicitOnly ? EXPLICIT_URL_RE : URL_RE)) {
    const raw = match[0]
    const url = normalizeExternalUrl(raw)
    const index = match.index ?? 0

    if (index > cursor) {
      nodes.push(text.slice(cursor, index))
    }

    nodes.push(
      pretty ? (
        <PrettyLink href={url} key={`${url}-${index}`} />
      ) : (
        <ExternalLink href={url} key={`${url}-${index}`}>
          {raw}
        </ExternalLink>
      )
    )

    cursor = index + raw.length
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return <span className={className}>{nodes.length ? nodes : text}</span>
}

export function __resetLinkTitleCache(): void {
  resetLinkTitleCache()
}
