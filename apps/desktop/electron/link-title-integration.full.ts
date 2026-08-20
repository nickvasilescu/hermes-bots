import { spawn } from 'node:child_process'

import { app, BrowserWindow, type IpcMain, session } from 'electron'

import { createLinkTitleWindow, guardLinkTitleSession, readLinkTitleWindowTitle } from './link-title-window'
import { hiddenWindowsChildOptions } from './windows-child-options'

const titleCache = new Map<string, string>()
const titleInflight = new Map<string, Promise<string>>()
const TITLE_CACHE_LIMIT = 500
const TITLE_BYTE_BUDGET = 96 * 1024
const TITLE_TIMEOUT_MS = 5000
const TITLE_MAX_REDIRECTS = 3

const TITLE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

const TITLE_ERROR_RE =
  /\b(access denied|attention required|captcha|error|forbidden|just a moment|request blocked|too many requests)\b/i

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'"
}

const RENDER_TITLE_MAX_CONCURRENT = 2
const RENDER_TITLE_TIMEOUT_MS = 8000
const RENDER_TITLE_GRACE_MS = 700

const RENDER_TITLE_BLOCKED_RESOURCES = new Set([
  'cspReport',
  'font',
  'imageset',
  'media',
  'object',
  'ping',
  'stylesheet'
])

let linkTitleSession: Electron.Session | null = null
let renderTitleInFlight = 0
const renderTitleQueue: Array<{ resolve: (title: string) => void; url: string }> = []

function canonicalTitleCacheKey(rawUrl: unknown): string {
  const value = String(rawUrl || '').trim()

  if (!value) {return ''}

  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '') || '/'

    return `${host}${pathname}${url.search || ''}`
  } catch {
    return value
  }
}

function cacheTitle(key: string, title: string): void {
  if (titleCache.size >= TITLE_CACHE_LIMIT) {
    const first = titleCache.keys().next().value

    if (first) {titleCache.delete(first)}
  }

  titleCache.set(key, title)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_, key) => HTML_ENTITIES[String(key).toLowerCase()] ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10) || 32))
}

function parseHtmlTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  return raw ? decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim() : ''
}

function fetchHtmlTitleWithCurl(rawUrl: string): Promise<string> {
  return new Promise(resolve => {
    const url = String(rawUrl || '').trim()

    if (!url) {return resolve('')}

    const child = spawn(
      'curl',
      [
        '--silent',
        '--show-error',
        '--location',
        '--max-redirs',
        String(TITLE_MAX_REDIRECTS),
        '--max-time',
        String(Math.max(2, Math.ceil(TITLE_TIMEOUT_MS / 1000))),
        '--connect-timeout',
        '4',
        '--user-agent',
        TITLE_USER_AGENT,
        '--header',
        'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        '--header',
        'Accept-Language: en-US,en;q=0.7',
        '--header',
        'Accept-Encoding: identity',
        '--raw',
        url
      ],
      hiddenWindowsChildOptions({ stdio: ['ignore', 'pipe', 'ignore'] })
    )

    const chunks: Buffer[] = []
    let bytes = 0

    child.stdout.on('data', chunk => {
      if (bytes >= TITLE_BYTE_BUDGET) {return}
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const next = buffer.subarray(0, TITLE_BYTE_BUDGET - bytes)
      chunks.push(next)
      bytes += next.length
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(chunks.length ? parseHtmlTitle(Buffer.concat(chunks).toString('utf8')) : ''))
  })
}

function getLinkTitleSession(): Electron.Session | null {
  if (linkTitleSession || !app.isReady()) {return linkTitleSession}

  linkTitleSession = session.fromPartition('hermes:link-titles', { cache: false })
  linkTitleSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: RENDER_TITLE_BLOCKED_RESOURCES.has(details.resourceType) })
  })
  guardLinkTitleSession(linkTitleSession)

  return linkTitleSession
}

function dequeueRenderTitle(): void {
  while (renderTitleInFlight < RENDER_TITLE_MAX_CONCURRENT && renderTitleQueue.length) {
    const item = renderTitleQueue.shift()

    if (!item) {return}
    renderTitleInFlight += 1
    void runRenderTitleJob(item.url).then(title => {
      renderTitleInFlight -= 1
      item.resolve(title)
      dequeueRenderTitle()
    })
  }
}

function runRenderTitleJob(rawUrl: string): Promise<string> {
  return new Promise(resolve => {
    const partitionSession = getLinkTitleSession()

    if (!app.isReady() || !partitionSession) {return resolve('')}

    let settled = false
    let window: BrowserWindow | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (title: string) => {
      if (settled) {return}
      settled = true

      if (hardTimer) {clearTimeout(hardTimer)}

      if (graceTimer) {clearTimeout(graceTimer)}
      const value = (title || '').replace(/\s+/g, ' ').trim()

      try {
        if (window && !window.isDestroyed()) {window.destroy()}
      } catch {
        // The short-lived window may already be gone.
      }

      resolve(value)
    }

    try {
      window = createLinkTitleWindow(BrowserWindow, partitionSession)
    } catch {
      return finish('')
    }

    const finishWithTitle = () => finish(readLinkTitleWindowTitle(window))

    const scheduleGrace = () => {
      if (graceTimer) {clearTimeout(graceTimer)}
      graceTimer = setTimeout(finishWithTitle, RENDER_TITLE_GRACE_MS)
    }

    hardTimer = setTimeout(finishWithTitle, RENDER_TITLE_TIMEOUT_MS)
    window.webContents.setUserAgent(TITLE_USER_AGENT)
    window.webContents.on('page-title-updated', scheduleGrace)
    window.webContents.on('did-finish-load', scheduleGrace)
    window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) {finish('')}
    })
    void window
      .loadURL(rawUrl, { httpReferrer: 'https://www.google.com/', userAgent: TITLE_USER_AGENT })
      .catch(() => finish(''))
  })
}

function fetchHtmlTitleWithRenderer(rawUrl: string): Promise<string> {
  return new Promise(resolve => {
    renderTitleQueue.push({ resolve, url: rawUrl })
    dequeueRenderTitle()
  })
}

function usableTitle(value: string): string {
  return value && !TITLE_ERROR_RE.test(value) ? value : ''
}

function fetchLinkTitle(rawUrl: unknown): Promise<string> {
  const url = String(rawUrl || '').trim()
  const key = canonicalTitleCacheKey(url)

  if (!key) {return Promise.resolve('')}

  if (titleCache.has(key)) {return Promise.resolve(titleCache.get(key) ?? '')}
  const active = titleInflight.get(key)

  if (active) {return active}

  const pending = fetchHtmlTitleWithCurl(url)
    .catch(() => '')
    .then(value => usableTitle((value || '').slice(0, 240)))
    .then(async value => value || usableTitle((await fetchHtmlTitleWithRenderer(url).catch(() => '')).slice(0, 240)))
    .then(clean => {
      cacheTitle(key, clean)
      titleInflight.delete(key)

      return clean
    })

  titleInflight.set(key, pending)

  return pending
}

export function registerLinkTitleIntegration(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle('hermes:fetchLinkTitle', (_event, url) => fetchLinkTitle(url))
}
