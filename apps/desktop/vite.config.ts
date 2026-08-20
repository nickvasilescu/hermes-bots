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
  /(?:add provider|always allow|allow this session|api[ -]?key|archive skill|authenticated provider|automatic updates|backup|check for updates|cloud account|cloud computer|composio|create profile|credential|curator|debug share|delete .*data|delete job|delete profile|disable unused|doctor|edit soul|export profile|gateway token|hermes cloud|import profile|install skill|install theme|local gateway|mcp|memory graph|new profile|oauth|orgo|pause job|provider account|provider key|refresh models|remote gateway|remote url|rename profile|reset memory|restart gateway|resume job|run now|run setup|security audit|self-update|session token|starmap|store .*plain text|uninstall|update from source|update hermes|update installed|yolo)/i

const SSH_FORBIDDEN_I18N_ACTION_KEYS = new Set([
  'keybinds.openPanel',
  'keybinds.panel',
  'layout.editMode',
  'layout.reset',
  'plugins.reload',
  'view.flipPanes',
  'view.showTerminal',
  'view.toggleHud',
  'view.toggleRightSidebar',
  'view.toggleSidebar',
  'view.toggleStatusbar',
  'workspace.openFolder'
])

function sanitizeSshOnlyEnglish(source: string): string {
  const file = ts.createSourceFile('en.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const replacements: Array<{ end: number; start: number; text: string }> = []

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
    const propertyName =
      ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
        ? node.name.text
        : null

    if (propertyName && SSH_FORBIDDEN_I18N_ACTION_KEYS.has(propertyName)) {
      replacements.push({
        start: node.getStart(file),
        end: node.getEnd(),
        text: `${JSON.stringify(`ssh.unavailable.${node.getStart(file)}`)}: "Unavailable in SSH client."`
      })

      return
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName &&
      ['cronSuggestions', 'fieldCopy', 'handoff', 'maintenance'].includes(propertyName)
    ) {
      // Messaging's credential field catalog uses API/env key names as object
      // keys, so scrubbing only string values would still retain the entire
      // credential form schema. The SSH renderer never imports that editor.
      replacements.push({ start: node.initializer.getStart(file), end: node.initializer.getEnd(), text: '{}' })

      return
    }

    if (ts.isStringLiteralLike(node) && shouldScrub(node.text)) {
      replacements.push({ start: node.getStart(file), end: node.getEnd(), text: '"Unavailable in SSH client."' })

      return
    }

    if (ts.isTemplateExpression(node) && shouldScrub(node.getText(file))) {
      replacements.push({ start: node.getStart(file), end: node.getEnd(), text: '"Unavailable in SSH client."' })

      return
    }

    ts.forEachChild(node, visit)
  }

  visit(file)

  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`,
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

const sshOnlyContentSecurityPolicy = (enabled: boolean) => ({
  name: 'hermes:ssh-only-csp',
  transformIndexHtml(html: string) {
    if (!enabled) return html

    return html.replace("connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*", "connect-src 'self'")
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
    plugins: [
      sshOnlyI18nEnglish(sshOnly),
      sshOnlyContentSecurityPolicy(sshOnly),
      react(),
      tailwindcss(),
      emojibaseAssets()
    ],
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
        '@desktop/artifacts-view': rendererSkuModule(
          './src/app/artifacts/index.tsx',
          './src/app/artifacts/index.disabled.tsx'
        ),
        '@desktop/approval-options': rendererSkuModule(
          './src/components/assistant-ui/tool/approval-options.full.tsx',
          './src/components/assistant-ui/tool/approval-options.disabled.tsx'
        ),
        '@desktop/attachment-readers': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/attachment-readers.full.ts',
          './src/app/session/hooks/use-prompt-actions/attachment-readers.disabled.ts'
        ),
        '@desktop/appearance-settings': rendererSkuModule(
          './src/app/settings/appearance-settings.tsx',
          './src/app/settings/appearance-settings.disabled.tsx'
        ),
        '@desktop/agent-avatar-client': rendererSkuModule(
          './src/components/assistant-ui/thread/agent-avatar-client.full.ts',
          './src/components/assistant-ui/thread/agent-avatar-client.disabled.ts'
        ),
        '@desktop/about-settings': rendererSkuModule(
          './src/app/settings/about-settings.tsx',
          './src/app/settings/about-settings.disabled.tsx'
        ),
        '@desktop/bot-setup-overlay': rendererSkuModule(
          './src/app/bot-product/setup-overlay.tsx',
          './src/app/bot-product/setup-overlay.disabled.tsx'
        ),
        '@desktop/bot-integration-sync': rendererSkuModule(
          './src/plugins/hermes-bots/integration-sync.full.js',
          './src/plugins/hermes-bots/integration-sync.disabled.js'
        ),
        '@desktop/bot-image-unavailable-copy': rendererSkuModule(
          './src/plugins/hermes-bots/image-unavailable-copy.full.js',
          './src/plugins/hermes-bots/image-unavailable-copy.disabled.js'
        ),
        '@desktop/boot-failure-overlay': rendererSkuModule(
          './src/components/boot-failure-overlay.tsx',
          './src/components/boot-failure-overlay.disabled.tsx'
        ),
        '@desktop/browser-slash-action': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/browser-slash-action.full.ts',
          './src/app/session/hooks/use-prompt-actions/browser-slash-action.disabled.ts'
        ),
        '@desktop/browser-slash-command': rendererSkuModule(
          './src/lib/browser-slash-command.full.ts',
          './src/lib/browser-slash-command.disabled.ts'
        ),
        '@desktop/chat-sidebar': rendererSkuModule(
          './src/app/chat/sidebar/index.tsx',
          './src/app/chat/sidebar/index.disabled.tsx'
        ),
        '@desktop/chat-surface-capabilities': rendererSkuModule(
          './src/app/chat/chat-surface-capabilities.full.ts',
          './src/app/chat/chat-surface-capabilities.disabled.ts'
        ),
        '@desktop/chrome-contributions': rendererSkuModule(
          './src/app/contrib/chrome-contributions.full.ts',
          './src/app/contrib/chrome-contributions.disabled.ts'
        ),
        '@desktop/chat-file-drop': rendererSkuModule(
          './src/app/chat/hooks/chat-file-drop.full.ts',
          './src/app/chat/hooks/chat-file-drop.disabled.ts'
        ),
        '@desktop/command-palette-settings': rendererSkuModule(
          './src/app/command-palette/settings-surface.full.ts',
          './src/app/command-palette/settings-surface.disabled.ts'
        ),
        '@desktop/command-palette': rendererSkuModule(
          './src/app/command-palette/index.tsx',
          './src/app/command-palette/index.disabled.tsx'
        ),
        '@desktop/config-write-client': rendererSkuModule(
          './src/lib/config-write-client.full.ts',
          './src/lib/config-write-client.disabled.ts'
        ),
        '@desktop/command-center-view': rendererSkuModule(
          './src/app/command-center/index.tsx',
          './src/app/command-center/index.disabled.tsx'
        ),
        '@desktop/command-center-surface': rendererSkuModule(
          './src/app/command-center/surface.full.tsx',
          './src/app/command-center/surface.disabled.tsx'
        ),
        '@desktop/cron-view': rendererSkuModule('./src/app/cron/index.tsx', './src/app/cron/index.disabled.tsx'),
        '@desktop/cron-list-client': rendererSkuModule(
          './src/app/session/hooks/cron-list-client.full.ts',
          './src/app/session/hooks/cron-list-client.disabled.ts'
        ),
        '@desktop/cron-suggestion-provider': rendererSkuModule(
          './src/store/suggestion-providers/cron.ts',
          './src/store/suggestion-providers/cron.disabled.ts'
        ),
        '@desktop/completion-ref-kinds': rendererSkuModule(
          './src/app/chat/composer/completion-ref-kinds.full.ts',
          './src/app/chat/composer/completion-ref-kinds.disabled.ts'
        ),
        '@desktop/composer-context-menu': rendererSkuModule(
          './src/app/chat/composer/context-menu.tsx',
          './src/app/chat/composer/context-menu.disabled.tsx'
        ),
        '@desktop/composer-controls': rendererSkuModule(
          './src/app/chat/composer/controls.tsx',
          './src/app/chat/composer/controls.disabled.tsx'
        ),
        '@desktop/composer-help-policy': rendererSkuModule(
          './src/app/chat/composer/composer-help-policy.full.ts',
          './src/app/chat/composer/composer-help-policy.disabled.ts'
        ),
        '@desktop/composer-runtime': rendererSkuModule(
          './src/app/chat/composer/composer-runtime.full.tsx',
          './src/app/chat/composer/composer-runtime.disabled.tsx'
        ),
        '@desktop/composer-status-stack': rendererSkuModule(
          './src/app/chat/composer/status-stack/index.tsx',
          './src/app/chat/composer/status-stack/index.disabled.tsx'
        ),
        '@desktop/floating-pet': rendererSkuModule(
          './src/components/pet/floating-pet.tsx',
          './src/components/pet/floating-pet.disabled.tsx'
        ),
        '@desktop/gateway-event-types': rendererSkuModule(
          './src/lib/gateway-event-types.full.ts',
          './src/lib/gateway-event-types.disabled.ts'
        ),
        '@desktop/install-overlay': rendererSkuModule(
          './src/components/desktop-install-overlay.tsx',
          './src/components/desktop-install-overlay.disabled.tsx'
        ),
        '@desktop/i18n-catalog': rendererSkuModule('./src/i18n/catalog.ts', './src/i18n/catalog.disabled.ts'),
        '@desktop/i18n-config-client': rendererSkuModule(
          './src/i18n/config-client.full.ts',
          './src/i18n/config-client.disabled.ts'
        ),
        '@desktop/keybind-actions': rendererSkuModule(
          './src/lib/keybinds/actions.ts',
          './src/lib/keybinds/actions.disabled.ts'
        ),
        '@desktop/gateway-restart-button': rendererSkuModule(
          './src/app/shell/gateway-restart-button.full.tsx',
          './src/app/shell/gateway-restart-button.disabled.tsx'
        ),
        '@desktop/file-attach-payload': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/file-attach-payload.full.ts',
          './src/app/session/hooks/use-prompt-actions/file-attach-payload.disabled.ts'
        ),
        '@desktop/handoff-session': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/use-handoff-session.full.ts',
          './src/app/session/hooks/use-prompt-actions/use-handoff-session.disabled.ts'
        ),
        '@desktop/handoff-slash-action': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/handoff-slash-action.full.ts',
          './src/app/session/hooks/use-prompt-actions/handoff-slash-action.disabled.ts'
        ),
        '@desktop/journey-slash-action': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/journey-slash-action.full.ts',
          './src/app/session/hooks/use-prompt-actions/journey-slash-action.disabled.ts'
        ),
        '@desktop/integration-store': rendererSkuModule(
          './src/app/right-sidebar/store.full.ts',
          './src/app/right-sidebar/store.disabled.ts'
        ),
        '@desktop/integration-surfaces': rendererSkuModule(
          './src/app/contrib/integration-surfaces.full.tsx',
          './src/app/contrib/integration-surfaces.disabled.tsx'
        ),
        '@desktop/local-file-surfaces': rendererSkuModule(
          './src/app/contrib/local-file-surfaces.full.ts',
          './src/app/contrib/local-file-surfaces.disabled.tsx'
        ),
        '@desktop/layout-edit-surfaces': rendererSkuModule(
          './src/components/pane-shell/tree/renderer/layout-edit-surfaces.full.tsx',
          './src/components/pane-shell/tree/renderer/layout-edit-surfaces.disabled.tsx'
        ),
        '@desktop/local-panes': rendererSkuModule(
          './src/app/contrib/panes.tsx',
          './src/app/contrib/panes.disabled.tsx'
        ),
        '@desktop/link-title-client': linkTitleClient,
        '@desktop/logs-client': rendererSkuModule('./src/lib/logs-client.full.ts', './src/lib/logs-client.disabled.ts'),
        '@desktop/markdown-embeds': rendererSkuModule(
          './src/components/assistant-ui/markdown-embeds.full.ts',
          './src/components/assistant-ui/markdown-embeds.disabled.ts'
        ),
        '@desktop/external-directive-action': rendererSkuModule(
          './src/lib/external-directive-action.full.ts',
          './src/lib/external-directive-action.disabled.ts'
        ),
        '@desktop/mcp-repair-provider': rendererSkuModule(
          './src/store/suggestion-providers/repair.ts',
          './src/store/suggestion-providers/repair.disabled.ts'
        ),
        '@desktop/mcp-setup-events': rendererSkuModule(
          './src/store/mcp-setup-events.full.ts',
          './src/store/mcp-setup-events.disabled.ts'
        ),
        '@desktop/mcp-setup-tool': rendererSkuModule(
          './src/components/assistant-ui/mcp-setup-tool.tsx',
          './src/components/assistant-ui/mcp-setup-tool.disabled.tsx'
        ),
        '@desktop/mcp-suggestion-provider': rendererSkuModule(
          './src/store/suggestion-providers/mcp.ts',
          './src/store/suggestion-providers/mcp.disabled.ts'
        ),
        '@desktop/mcp-tab': rendererSkuModule('./src/app/skills/mcp-tab.tsx', './src/app/skills/mcp-tab.disabled.tsx'),
        '@desktop/messaging-view': rendererSkuModule(
          './src/app/messaging/index.tsx',
          './src/app/messaging/index.disabled.tsx'
        ),
        '@desktop/model-refresh-footer': rendererSkuModule(
          './src/app/shell/model-refresh-footer.full.tsx',
          './src/app/shell/model-refresh-footer.disabled.tsx'
        ),
        '@desktop/mini-owned-slash-commands': rendererSkuModule(
          './src/lib/mini-owned-slash-commands.full.ts',
          './src/lib/mini-owned-slash-commands.disabled.ts'
        ),
        '@desktop/mini-owned-gateway-events': rendererSkuModule(
          './src/app/session/hooks/use-message-stream/mini-owned-events.full.ts',
          './src/app/session/hooks/use-message-stream/mini-owned-events.disabled.ts'
        ),
        '@desktop/plugin-discovery': rendererSkuModule('./src/contrib/plugins.ts', './src/contrib/plugins.disabled.ts'),
        '@desktop/model-picker-provider-action': rendererSkuModule(
          './src/components/model-picker-provider-action.full.tsx',
          './src/components/model-picker-provider-action.disabled.tsx'
        ),
        '@desktop/onboarding-events': rendererSkuModule(
          './src/store/onboarding-events.full.ts',
          './src/store/onboarding-events.disabled.ts'
        ),
        '@desktop/onboarding-overlay': rendererSkuModule(
          './src/components/onboarding-overlay.full.tsx',
          './src/components/onboarding-overlay.disabled.tsx'
        ),
        '@desktop/notification-provider-errors': rendererSkuModule(
          './src/lib/notification-provider-errors.full.ts',
          './src/lib/notification-provider-errors.disabled.ts'
        ),
        '@desktop/open-external-client': rendererSkuModule(
          './src/lib/open-external-client.full.ts',
          './src/lib/open-external-client.disabled.ts'
        ),
        '@desktop/provider-setup-errors': rendererSkuModule(
          './src/lib/provider-setup-errors.ts',
          './src/lib/provider-setup-errors.disabled.ts'
        ),
        '@desktop/profile-rail': rendererSkuModule(
          './src/app/chat/sidebar/profile-switcher.tsx',
          './src/app/chat/sidebar/profile-rail.disabled.tsx'
        ),
        '@desktop/prompt-overlays': rendererSkuModule(
          './src/components/prompt-overlays.tsx',
          './src/components/prompt-overlays.disabled.tsx'
        ),
        '@desktop/path-completion-params': rendererSkuModule(
          './src/lib/path-completion-params.full.ts',
          './src/lib/path-completion-params.disabled.ts'
        ),
        '@desktop/persistent-terminal': rendererSkuModule(
          './src/app/right-sidebar/terminal/persistent.tsx',
          './src/app/right-sidebar/terminal/persistent.disabled.tsx'
        ),
        '@desktop/pet-generate-overlay': rendererSkuModule(
          './src/app/pet-generate/pet-generate-overlay.tsx',
          './src/app/pet-generate/pet-generate-overlay.disabled.tsx'
        ),
        '@desktop/pet-overlay-root': rendererSkuModule(
          './src/app/pet-overlay/overlay-root.tsx',
          './src/app/pet-overlay/overlay-root.disabled.tsx'
        ),
        '@desktop/pet-presence': rendererSkuModule(
          './src/app/contrib/pet-presence.full.ts',
          './src/app/contrib/pet-presence.disabled.ts'
        ),
        '@desktop/pet-event-actions': rendererSkuModule(
          './src/app/session/hooks/use-message-stream/pet-event-actions.full.ts',
          './src/app/session/hooks/use-message-stream/pet-event-actions.disabled.ts'
        ),
        '@desktop/profiles-view': rendererSkuModule(
          './src/app/profiles/index.tsx',
          './src/app/profiles/index.disabled.tsx'
        ),
        '@desktop/profile-management-actions': rendererSkuModule(
          './src/app/chat/sidebar/profile-management-actions.full.tsx',
          './src/app/chat/sidebar/profile-management-actions.disabled.tsx'
        ),
        '@desktop/project-event-actions': rendererSkuModule(
          './src/app/session/hooks/use-message-stream/project-event-actions.full.ts',
          './src/app/session/hooks/use-message-stream/project-event-actions.disabled.ts'
        ),
        '@desktop/project-config-client': rendererSkuModule(
          './src/lib/project-config-client.full.ts',
          './src/lib/project-config-client.disabled.ts'
        ),
        '@desktop/profile-create-action': rendererSkuModule(
          './src/app/hooks/profile-create-action.full.ts',
          './src/app/hooks/profile-create-action.disabled.ts'
        ),
        '@desktop/product-layout-policy': rendererSkuModule(
          './src/app/contrib/product-layout-policy.full.ts',
          './src/app/contrib/product-layout-policy.disabled.ts'
        ),
        '@desktop/preview-tiles': rendererSkuModule(
          './src/app/chat/preview-tile.tsx',
          './src/app/chat/preview-tile.disabled.ts'
        ),
        '@desktop/profile-transfer-contributions': rendererSkuModule(
          './src/app/contrib/profile-transfer-contributions.full.ts',
          './src/app/contrib/profile-transfer-contributions.disabled.ts'
        ),
        '@desktop/runtime-readiness-copy': rendererSkuModule(
          './src/lib/runtime-readiness-copy.full.ts',
          './src/lib/runtime-readiness-copy.disabled.ts'
        ),
        '@desktop/runtime-plugin-loader': rendererSkuModule(
          './src/contrib/runtime-loader.ts',
          './src/contrib/runtime-loader.disabled.ts'
        ),
        '@desktop/sdk-integration-host': rendererSkuModule(
          './src/sdk/integration-host.full.ts',
          './src/sdk/integration-host.disabled.ts'
        ),
        '@desktop/settings': rendererSkuModule('./src/app/settings/index.tsx', './src/app/settings/index.disabled.tsx'),
        '@desktop/shell-context-menu': rendererSkuModule(
          './src/app/shell/shell-context-menu.tsx',
          './src/app/shell/shell-context-menu.disabled.tsx'
        ),
        '@desktop/sidebar-mini-owned-nav': rendererSkuModule(
          './src/app/chat/sidebar/mini-owned-nav.full.tsx',
          './src/app/chat/sidebar/mini-owned-nav.disabled.ts'
        ),
        '@desktop/sidebar-cron-jobs-section': rendererSkuModule(
          './src/app/chat/sidebar/cron-jobs-section.tsx',
          './src/app/chat/sidebar/cron-jobs-section.disabled.tsx'
        ),
        '@desktop/session-tile-resume-payload': rendererSkuModule(
          './src/app/contrib/hooks/session-tile-resume-payload.full.ts',
          './src/app/contrib/hooks/session-tile-resume-payload.disabled.ts'
        ),
        '@desktop/session-actions-menu': rendererSkuModule(
          './src/app/chat/sidebar/session-actions-menu.tsx',
          './src/app/chat/sidebar/session-actions-menu.disabled.tsx'
        ),
        '@desktop/session-title': rendererSkuModule(
          './src/app/chat/session-title.full.tsx',
          './src/app/chat/session-title.disabled.tsx'
        ),
        '@desktop/sessions-settings': rendererSkuModule(
          './src/app/settings/sessions-settings.tsx',
          './src/app/settings/sessions-settings.disabled.tsx'
        ),
        '@desktop/ssh-slash-dispatch': rendererSkuModule(
          './src/lib/ssh-slash-dispatch.full.ts',
          './src/lib/ssh-slash-dispatch.disabled.ts'
        ),
        '@desktop/skills-modes': rendererSkuModule(
          './src/app/skills/modes.full.ts',
          './src/app/skills/modes.disabled.ts'
        ),
        '@desktop/skills-view': rendererSkuModule('./src/app/skills/index.tsx', './src/app/skills/index.disabled.tsx'),
        '@desktop/skill-suggestion-provider': rendererSkuModule(
          './src/store/suggestion-providers/skill.ts',
          './src/store/suggestion-providers/skill.disabled.ts'
        ),
        '@desktop/starmap-store': rendererSkuModule('./src/store/starmap.ts', './src/store/starmap.disabled.ts'),
        '@desktop/starmap-view': rendererSkuModule(
          './src/app/starmap/index.tsx',
          './src/app/starmap/index.disabled.tsx'
        ),
        '@desktop/statusbar-surface': rendererSkuModule(
          './src/app/contrib/statusbar-surface.full.tsx',
          './src/app/contrib/statusbar-surface.disabled.tsx'
        ),
        '@desktop/statusbar-fallback': rendererSkuModule(
          './src/app/contrib/statusbar-fallback.full.tsx',
          './src/app/contrib/statusbar-fallback.disabled.tsx'
        ),
        '@desktop/toolset-computer-use-panel': rendererSkuModule(
          './src/app/settings/computer-use-panel.tsx',
          './src/app/settings/computer-use-panel.disabled.tsx'
        ),
        '@desktop/terminal-surface': rendererSkuModule(
          './src/app/contrib/terminal-surface.full.tsx',
          './src/app/contrib/terminal-surface.disabled.tsx'
        ),
        '@desktop/terminal-takeover': rendererSkuModule(
          './src/app/right-sidebar/store.ts',
          './src/app/right-sidebar/store.disabled.ts'
        ),
        '@desktop/toolset-config-panel': rendererSkuModule(
          './src/app/settings/toolset-config-panel.tsx',
          './src/app/settings/toolset-config-panel.disabled.tsx'
        ),
        '@desktop/toolset-terminal-backend-panel': rendererSkuModule(
          './src/app/settings/terminal-backend-panel.tsx',
          './src/app/settings/terminal-backend-panel.disabled.tsx'
        ),
        '@desktop/trigger-cron-job': rendererSkuModule(
          './src/app/contrib/trigger-cron-job.full.ts',
          './src/app/contrib/trigger-cron-job.disabled.ts'
        ),
        '@desktop/updates-overlay': rendererSkuModule(
          './src/app/updates-overlay.tsx',
          './src/app/updates-overlay.disabled.tsx'
        ),
        '@desktop/use-slash-command': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/slash.ts',
          './src/app/session/hooks/use-prompt-actions/slash.disabled.ts'
        ),
        '@desktop/use-cwd-actions': rendererSkuModule(
          './src/app/session/hooks/use-cwd-actions.ts',
          './src/app/session/hooks/use-cwd-actions.disabled.ts'
        ),
        '@desktop/use-hermes-config': rendererSkuModule(
          './src/app/session/hooks/use-hermes-config.ts',
          './src/app/session/hooks/use-hermes-config.disabled.ts'
        ),
        '@desktop/use-keybinds': rendererSkuModule(
          './src/app/hooks/use-keybinds.ts',
          './src/app/hooks/use-keybinds.disabled.ts'
        ),
        '@desktop/use-pet-bridge': rendererSkuModule(
          './src/app/contrib/hooks/use-pet-bridge.ts',
          './src/app/contrib/hooks/use-pet-bridge.disabled.ts'
        ),
        '@desktop/use-preview-routing': rendererSkuModule(
          './src/app/session/hooks/use-preview-routing.ts',
          './src/app/session/hooks/use-preview-routing.disabled.ts'
        ),
        '@desktop/vibe-hearts': rendererSkuModule(
          './src/components/chat/vibe-hearts.tsx',
          './src/components/chat/vibe-hearts.disabled.tsx'
        ),
        '@desktop/use-composer-actions': rendererSkuModule(
          './src/app/chat/hooks/use-composer-actions.ts',
          './src/app/chat/hooks/use-composer-actions.disabled.ts'
        ),
        '@desktop/webhooks-view': rendererSkuModule(
          './src/app/webhooks/index.tsx',
          './src/app/webhooks/index.disabled.tsx'
        ),
        '@desktop/yolo-contribution': rendererSkuModule(
          './src/app/contrib/yolo-contribution.full.ts',
          './src/app/contrib/yolo-contribution.disabled.ts'
        ),
        '@desktop/yolo-slash-action': rendererSkuModule(
          './src/app/session/hooks/use-prompt-actions/yolo-slash-action.full.ts',
          './src/app/session/hooks/use-prompt-actions/yolo-slash-action.disabled.ts'
        ),
        '@/lib/yolo-session': rendererSkuModule('./src/lib/yolo-session.ts', './src/lib/yolo-session.disabled.ts'),
        '@/components/assistant-ui/markdown-text': rendererSkuModule(
          './src/components/assistant-ui/markdown-text.tsx',
          './src/components/assistant-ui/markdown-text.disabled.tsx'
        ),
        '@/components/assistant-ui/thread/user-edit-composer': rendererSkuModule(
          './src/components/assistant-ui/thread/user-edit-composer.tsx',
          './src/components/assistant-ui/thread/user-edit-composer.disabled.tsx'
        ),
        '@/components/chat/compact-markdown': rendererSkuModule(
          './src/components/chat/compact-markdown.tsx',
          './src/components/chat/compact-markdown.disabled.tsx'
        ),
        '@/components/chat/generated-image-result': rendererSkuModule(
          './src/components/chat/generated-image-result.tsx',
          './src/components/chat/generated-image-result.disabled.tsx'
        ),
        '@/components/chat/preview-attachment': rendererSkuModule(
          './src/components/chat/preview-attachment.tsx',
          './src/components/chat/preview-attachment.disabled.tsx'
        ),
        '@/lib/external-link': rendererSkuModule('./src/lib/external-link.tsx', './src/lib/external-link.disabled.tsx'),
        '@/lib/keybinds/actions': rendererSkuModule(
          './src/lib/keybinds/actions.ts',
          './src/lib/keybinds/actions.disabled.ts'
        ),
        '@/lib/desktop-fs': rendererSkuModule('./src/lib/desktop-fs.ts', './src/lib/desktop-fs.disabled.ts'),
        '@/lib/desktop-git': rendererSkuModule('./src/lib/desktop-git.ts', './src/lib/desktop-git.disabled.ts'),
        '@/lib/media': rendererSkuModule('./src/lib/media.ts', './src/lib/media.disabled.ts'),
        '@/lib/desktop-slash-commands': rendererSkuModule(
          './src/lib/desktop-slash-commands.ts',
          './src/lib/desktop-slash-commands.disabled.ts'
        ),
        '@/store/mcp-setup': rendererSkuModule('./src/store/mcp-setup.ts', './src/store/mcp-setup.disabled.ts'),
        '@/store/profile-share': rendererSkuModule(
          './src/store/profile-share.ts',
          './src/store/profile-share.disabled.ts'
        ),
        '@/store/projects': rendererSkuModule('./src/store/projects.ts', './src/store/projects.disabled.ts'),
        '@/store/reactions-enabled': rendererSkuModule(
          './src/store/reactions-enabled.ts',
          './src/store/reactions-enabled.disabled.ts'
        ),
        '@/store/system-actions': rendererSkuModule(
          './src/store/system-actions.ts',
          './src/store/system-actions.disabled.ts'
        ),
        '@/store/voice-prefs': rendererSkuModule('./src/store/voice-prefs.ts', './src/store/voice-prefs.disabled.ts'),
        '@/store/updates': rendererSkuModule('./src/store/updates.ts', './src/store/updates.disabled.ts'),
        '@/debug/dev-only': debugEntry(command, process.env as Record<string, string>),
        '@': path.resolve(import.meta.dirname, './src'),
        '@bot-mode/plugin': rendererSkuModule(
          './src/plugins/hermes-bots/legacy-plugin.js',
          './src/plugins/hermes-bots/legacy-plugin.disabled.js'
        ),
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
