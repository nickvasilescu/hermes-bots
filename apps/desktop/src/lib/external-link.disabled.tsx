import type { ComponentProps, ReactNode } from 'react'

export function normalizeExternalUrl(value: string): string {
  return value.trim()
}

export function shortHostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

export function hostPathLabel(value: string): string {
  return value
}

export function urlSlugTitleLabel(value: string): string {
  return value
}

export function isTitleFetchable(_value: string): boolean {
  return false
}

export function fetchLinkTitle(_url: string): Promise<string> {
  return Promise.resolve('')
}

export function useLinkTitle(_url?: null | string): string {
  return ''
}

export function openExternalLink(_href: string): void {}

export function ExternalLinkIcon(_props: { className?: string }) {
  return null
}

export function LinkBrandIcon(_props: { className?: string; href: string }) {
  return null
}

interface ExternalLinkProps extends Omit<ComponentProps<'a'>, 'href' | 'target'> {
  href: string
  children?: ReactNode
  showExternalIcon?: boolean
}

export function ExternalLink({ children, className, href }: ExternalLinkProps) {
  return <span className={className}>{children ?? href}</span>
}

interface PrettyLinkProps extends Omit<ComponentProps<'a'>, 'href' | 'target'> {
  href: string
  label?: string
  fallbackLabel?: string
}

export function PrettyLink({ className, fallbackLabel, href, label }: PrettyLinkProps) {
  return <span className={className}>{label?.trim() || fallbackLabel?.trim() || href}</span>
}

export function LinkifiedText({
  className,
  text
}: {
  className?: string
  text: string
  pretty?: boolean
  explicitOnly?: boolean
}) {
  return <span className={className}>{text}</span>
}

export function __resetLinkTitleCache(): void {}
