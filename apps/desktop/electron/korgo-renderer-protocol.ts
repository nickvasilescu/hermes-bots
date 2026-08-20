import fs from 'node:fs'
import path from 'node:path'

export const KORGO_RENDERER_SCHEME = 'korgo-app'
export const KORGO_RENDERER_ENTRY_URL = `${KORGO_RENDERER_SCHEME}://bundle/index.html`

interface ProtocolApi {
  handle: (scheme: string, handler: (request: Request) => Promise<Response>) => void
  registerSchemesAsPrivileged: (
    schemes: Array<{
      scheme: string
      privileges: {
        corsEnabled: boolean
        secure: boolean
        standard: boolean
        supportFetchAPI: boolean
      }
    }>
  ) => void
}

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
})

export function registerKorgoRendererScheme(protocol: ProtocolApi): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: KORGO_RENDERER_SCHEME,
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true
      }
    }
  ])
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)

  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

async function containsSymlink(root: string, candidate: string): Promise<boolean> {
  const relative = path.relative(root, candidate)
  let cursor = root

  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)

    if ((await fs.promises.lstat(cursor)).isSymbolicLink()) {
      return true
    }
  }

  return false
}

async function resolveRequestFile(root: string, rawUrl: string): Promise<string | null> {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (
    url.protocol !== `${KORGO_RENDERER_SCHEME}:` ||
    url.hostname !== 'bundle' ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null
  }

  let relative: string

  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  } catch {
    return null
  }

  if (relative.includes('\0')) {
    return null
  }

  const lexicalRoot = path.resolve(root)
  const lexicalCandidate = path.resolve(lexicalRoot, relative)

  if (!isInside(lexicalRoot, lexicalCandidate)) {
    return null
  }

  try {
    const [realRoot, realCandidate, stat, hasSymlink] = await Promise.all([
      fs.promises.realpath(lexicalRoot),
      fs.promises.realpath(lexicalCandidate),
      fs.promises.lstat(lexicalCandidate),
      containsSymlink(lexicalRoot, lexicalCandidate)
    ])

    return stat.isFile() && !hasSymlink && isInside(realRoot, realCandidate) ? realCandidate : null
  } catch {
    return null
  }
}

export function createKorgoRendererHandler(root: string): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }

    const filePath = await resolveRequestFile(root, request.url)

    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'

    const headers = {
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    }

    if (request.method === 'HEAD') {
      return new Response(null, { headers, status: 200 })
    }

    return new Response(await fs.promises.readFile(filePath), { headers, status: 200 })
  }
}

export function registerKorgoRendererProtocol(protocol: ProtocolApi, rendererRoot: string): void {
  protocol.handle(KORGO_RENDERER_SCHEME, createKorgoRendererHandler(rendererRoot))
}
