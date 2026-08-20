import fs from 'fs'
import path from 'path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import ts from 'typescript'
import { defineConfig } from 'vite'

// `hgui` symlinks a worktree's node_modules to the main checkout. Vite realpaths
// those before enforcing server.fs.allow, so codicon/font assets resolve outside
// the worktree root and 404. Whitelist the real node_modules locations.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

// Always build the tracked first-party copy. Falling back to a machine-local
// desktop plugin made local builds pass while clean checkouts and CI were
// missing the actual Bot interface.
const botModePlugin = path.resolve(import.meta.dirname, './src/plugins/hermes-bots/legacy-plugin.js')

const fsAllow = [
  ...new Set(
    [
      path.resolve(import.meta.dirname, '../..'),
      path.dirname(botModePlugin),
      real(path.resolve(import.meta.dirname, 'node_modules')),
      real(path.resolve(import.meta.dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

// The dev-only render/state churn counters (src/debug) must be imported
// STATICALLY above react-dom — react-dom captures the devtools hook at module
// init, so a dynamic import lands too late and observes zero commits. A static
// side-effect import can't be tree-shaken, so instead the whole graph is
// aliased out of any non-dev build. `command === 'serve'` covers `vite dev`;
// the perf harness opts a production build back in with VITE_PERF_PROBE=1.
const debugEntry = (command: string, env: Record<string, string>) =>
  command === 'serve' || env.VITE_PERF_PROBE === '1'
    ? path.resolve(import.meta.dirname, './src/debug/dev-only.ts')
    : path.resolve(import.meta.dirname, './src/debug/dev-only.noop.ts')

const desktopSku = (): 'hermes' | 'bot' | 'bot-ssh-only' => {
  if (process.env.VITE_HERMES_DESKTOP_SKU === 'bot-ssh-only') {
    return 'bot-ssh-only'
  }

  if (process.env.VITE_HERMES_DESKTOP_SKU === 'bot' || process.env.VITE_HERMES_DESKTOP_PRODUCT === 'bot') {
    return 'bot'
  }

  return 'hermes'
}

// The emoji picker (frimousse) fetches `<emojibaseUrl>/<locale>/data.json` at
// runtime. Its default is a CDN; Electron must work offline, so serve the
// bundled emojibase-data package at a stable local path instead — middleware
// in dev, emitted assets in the build. Only the files a locale actually needs.
const emojibaseDir =
  real(path.resolve(import.meta.dirname, 'node_modules/emojibase-data')) ??
  real(path.resolve(import.meta.dirname, '../../node_modules/emojibase-data'))

const EMOJIBASE_PATH = /^[a-z-]+\/(data|messages|shortcodes\/emojibase)\.json$/

const emojibaseAssets = () => ({
  name: 'hermes:emojibase-assets',
  configureServer(server: {
    middlewares: { use: (route: string, handler: (req: any, res: any, next: () => void) => void) => void }
  }) {
    server.middlewares.use('/emojibase', (req, res, next) => {
      const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')

      if (!emojibaseDir || !EMOJIBASE_PATH.test(rel)) {
        return next()
      }

      fs.readFile(path.join(emojibaseDir, rel), (err: unknown, buf: Buffer) => {
        if (err) {
          return next()
        }

        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.end(buf)
      })
    })
  },
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
    if (!emojibaseDir) {
      return
    }

    for (const rel of ['en/data.json', 'en/messages.json', 'en/shortcodes/emojibase.json']) {
      this.emitFile({
        type: 'asset',
        fileName: `emojibase/${rel}`,
        source: fs.readFileSync(path.join(emojibaseDir, rel))
      })
    }
  }
})

const SSH_I18N_VIRTUAL_ID = '\0hermes:ssh-only-english.ts'
const SSH_I18N_IMPORT_ID = '@desktop/i18n-ssh-english'

const SENSITIVE_I18N_COPY =
  /(?:api[ -]?key|cloud account|cloud computer|composio|credential|gateway token|hermes cloud|local gateway|oauth|orgo|provider account|provider key|remote gateway|remote url|session token|store .*plain text)/i

function sanitizeSshOnlyEnglish(source: string): string {
  const file = ts.createSourceFile('en.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const replacements: Array<{ end: number; start: number }> = []

  const shouldScrub = (text: string) => {
    if (SENSITIVE_I18N_COPY.test(text)) {
      return true
    }

    if (!/tailscale/i.test(text)) {
      return false
    }

    // Strict SSH setup and error copy is intentionally retained. General
    // installation/provisioning copy is not part of this SKU.
    return !/(?:mini|numeric tailscale|reachable over tailscale|tailscale connectivity)/i.test(text)
  }

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && shouldScrub(node.text)) {
      replacements.push({ start: node.getStart(file), end: node.getEnd() })

      return
    }

    if (ts.isTemplateExpression(node) && shouldScrub(node.getText(file))) {
      replacements.push({ start: node.getStart(file), end: node.getEnd() })

      return
    }

    ts.forEachChild(node, visit)
  }

  visit(file)

  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}"Unavailable in SSH client."${result.slice(replacement.end)}`,
      source
    )
}

const sshOnlyI18nEnglish = (enabled: boolean) => ({
  name: 'hermes:ssh-only-i18n',
  resolveId(id: string) {
    return enabled && id === SSH_I18N_IMPORT_ID ? SSH_I18N_VIRTUAL_ID : null
  },
  load(id: string) {
    if (!enabled || id !== SSH_I18N_VIRTUAL_ID) {
      return null
    }

    return sanitizeSshOnlyEnglish(fs.readFileSync(path.resolve(import.meta.dirname, './src/i18n/en.ts'), 'utf8'))
  }
})

export default defineConfig(({ command }) => {
  const sku = desktopSku()
  const sshOnly = sku === 'bot-ssh-only'

  const rendererSkuModule = (full: string, disabled: string) =>
    path.resolve(import.meta.dirname, sshOnly ? disabled : full)

  const linkTitleClient = path.resolve(
    import.meta.dirname,
    sshOnly ? './src/lib/link-title-client.disabled.ts' : './src/lib/link-title-client.full.ts'
  )

  return {
    base: './',
    plugins: [sshOnlyI18nEnglish(sshOnly), react(), tailwindcss(), emojibaseAssets()],
    define: {
      'import.meta.env.VITE_HERMES_DESKTOP_SKU': JSON.stringify(sku),
      'import.meta.env.VITE_HERMES_DESKTOP_PRODUCT': JSON.stringify(sku === 'hermes' ? 'hermes' : 'bot')
    },
    css: {
      // Pin an explicit (empty) PostCSS config. Tailwind is handled entirely by
      // `@tailwindcss/vite`, so the renderer needs no PostCSS plugins — and
      // without this, Vite's `postcss-load-config` walks UP the filesystem
      // looking for a stray `postcss.config.*` / `tailwind.config.*`. The desktop
      // build runs from inside the user's home tree (e.g.
      // `C:\Users\<name>\AppData\Local\hermes\hermes-agent\apps\desktop`), so an
      // unrelated Tailwind v3 config higher up the tree gets picked up and
      // reprocesses our v4 stylesheet, failing the build with
      // "`@layer base` is used but no matching `@tailwind base` directive is
      // present." Pinning the config makes the build hermetic.
      postcss: { plugins: [] }
    },
    build: {
      // The renderer intentionally ships FEW chunks (not one, not thousands):
      //   · `codeSplitting: false` (the old setup) inlines every `lazy()` /
      //     dynamic import into the entry, so heavyweight lazy-only deps
      //     (mermaid, shiki grammars, katex) are parsed + evaluated on every
      //     cold start even though nothing rendered them. By the time the
      //     bundle hit ~28 MB that eval was ~1s of launch on an M-series.
      //   · Default splitting emits a chunk per shiki grammar/theme — thousands
      //     of files, which electron-builder OOMs scanning (#38888).
      // `advancedChunks` is the middle ground: heavyweight libraries merge into
      // a handful of named vendor chunks loaded on first use, app-level dynamic
      // imports stay lazy, and the file count stays in the tens.
      chunkSizeWarningLimit: 25000,
      rolldownOptions: {
        output: {
          advancedChunks: {
            groups: [
              // Shared foundations FIRST (first match wins): an unmatched
              // module shared by the entry and a heavy chunk gets merged INTO
              // the heavy chunk, and the entry then statically imports 19 MB of
              // shiki just to reach react/hast utils — putting the heavy chunk
              // right back on the boot path.
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
              {
                name: 'vendor-md',
                test: /node_modules[\\/](property-information|hast-util-[^\\/]+|mdast-util-[^\\/]+|micromark[^\\/]*|unist-util-[^\\/]+|vfile[^\\/]*|unified|stringify-entities|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|devlop|style-to-js|style-to-object|clsx)[\\/]/
              },
              // Shared utility packages the entry ALSO uses — kept out of the
              // heavy groups for the same boot-path reason.
              {
                name: 'vendor-util',
                test: /node_modules[\\/](lodash-es|es-toolkit|uuid|dayjs|d3-array|d3-color|d3-force|d3-interpolate|d3-time[^\\/]*|dompurify|stylis)[\\/]/
              },
              // One chunk per heavyweight, lazy-only library family.
              // @streamdown/code lives WITH shiki because it statically imports
              // the full shiki bundle.
              {
                name: 'mermaid',
                test: /node_modules[\\/](mermaid|cytoscape|dagre|khroma|elkjs|d3|d3-[^\\/]+|@mermaid-js)[\\/]/
              },
              {
                name: 'shiki',
                test: /node_modules[\\/](shiki|@shikijs|react-shiki|@streamdown[\\/]code|oniguruma-to-es|oniguruma-parser|regex(-[^\\/]+)?)[\\/]/
              },
              { name: 'katex', test: /node_modules[\\/]katex[\\/]/ }
            ]
          }
        }
      }
    },
    resolve: {
      alias: {
        '@desktop/bot-setup-overlay': rendererSkuModule(
          './src/app/bot-product/setup-overlay.tsx',
          './src/app/bot-product/setup-overlay.disabled.tsx'
        ),
        '@desktop/boot-failure-overlay': rendererSkuModule(
          './src/components/boot-failure-overlay.tsx',
          './src/components/boot-failure-overlay.disabled.tsx'
        ),
        '@desktop/install-overlay': rendererSkuModule(
          './src/components/desktop-install-overlay.tsx',
          './src/components/desktop-install-overlay.disabled.tsx'
        ),
        '@desktop/i18n-catalog': rendererSkuModule('./src/i18n/catalog.ts', './src/i18n/catalog.disabled.ts'),
        '@desktop/integration-store': rendererSkuModule(
          './src/app/right-sidebar/store.full.ts',
          './src/app/right-sidebar/store.disabled.ts'
        ),
        '@desktop/integration-surfaces': rendererSkuModule(
          './src/app/contrib/integration-surfaces.full.tsx',
          './src/app/contrib/integration-surfaces.disabled.tsx'
        ),
        '@desktop/link-title-client': linkTitleClient,
        '@desktop/sdk-integration-host': rendererSkuModule(
          './src/sdk/integration-host.full.ts',
          './src/sdk/integration-host.disabled.ts'
        ),
        '@desktop/settings': rendererSkuModule('./src/app/settings/index.tsx', './src/app/settings/index.disabled.tsx'),
        '@/debug/dev-only': debugEntry(command, process.env as Record<string, string>),
        '@': path.resolve(import.meta.dirname, './src'),
        '@bot-mode/plugin': botModePlugin,
        '@hermes/plugin-sdk': path.resolve(import.meta.dirname, './src/sdk/index.ts'),
        '@hermes/shared/billing': path.resolve(import.meta.dirname, '../shared/src/billing-types.ts'),
        '@hermes/shared': path.resolve(import.meta.dirname, '../shared/src'),
        react: path.resolve(import.meta.dirname, '../../node_modules/react'),
        'react-dom': path.resolve(import.meta.dirname, '../../node_modules/react-dom'),
        'react/jsx-dev-runtime': path.resolve(import.meta.dirname, '../../node_modules/react/jsx-dev-runtime.js'),
        'react/jsx-runtime': path.resolve(import.meta.dirname, '../../node_modules/react/jsx-runtime.js')
      },
      dedupe: ['react', 'react-dom', 'react-router']
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      fs: {
        allow: fsAllow
      }
    },
    preview: {
      host: '127.0.0.1',
      port: 4174
    }
  }
})
