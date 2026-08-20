import type { IpcChannelPolicy, IpcChannelPrivilege, IpcChannelRule, IpcRegistrationKind } from './ipc-policy'
import type { WindowCapability } from './ipc-trust'

interface PolicyGroup {
  capabilities: readonly WindowCapability[]
  channels: readonly string[]
  kind: IpcRegistrationKind
  privilege: IpcChannelPrivilege
}

const PRIMARY = Object.freeze(['primary'] as const)
const CHAT = Object.freeze(['primary', 'session', 'hud'] as const)
const PRIMARY_AND_SESSION = Object.freeze(['primary', 'session'] as const)
const HUD = Object.freeze(['hud'] as const)
const PET_OVERLAY = Object.freeze(['pet-overlay'] as const)
const QUICK_ENTRY = Object.freeze(['quick-entry'] as const)
const ALL_WINDOWS = Object.freeze(['primary', 'session', 'hud', 'quick-entry', 'pet-overlay'] as const)

export const PRIMARY_ONLY_IPC_PRIVILEGES = Object.freeze([
  'bootstrap',
  'clipboard',
  'connection-config',
  'connector-credentials',
  'external-open',
  'filesystem',
  'git',
  'host-integration',
  'permission',
  'profile-runtime',
  'terminal',
  'uninstall',
  'update'
] as const satisfies readonly IpcChannelPrivilege[])

const PRIMARY_ONLY_PRIVILEGE_SET = new Set<IpcChannelPrivilege>(PRIMARY_ONLY_IPC_PRIVILEGES)

// Exact channel names are intentional. Prefix rules would turn every future
// channel into an implicit grant and defeat the fail-closed registration gate.
const GROUPS: readonly PolicyGroup[] = [
  {
    capabilities: CHAT,
    channels: ['hermes:connection', 'hermes:connection:revalidate', 'hermes:backend:touch', 'hermes:gateway:ws-url'],
    kind: 'handle',
    privilege: 'gateway-runtime'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:api'],
    kind: 'handle',
    privilege: 'gateway-api'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:gateway-proxy:start'],
    kind: 'handle',
    privilege: 'gateway-runtime'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:gateway-proxy:send', 'hermes:gateway-proxy:close'],
    kind: 'on',
    privilege: 'gateway-runtime'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:boot-progress:get',
      'hermes:bootstrap:get',
      'hermes:bootstrap:reset',
      'hermes:bootstrap:repair',
      'hermes:bootstrap:continue-local',
      'hermes:bootstrap:cancel'
    ],
    kind: 'handle',
    privilege: 'bootstrap'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:connection-config:get',
      'hermes:connection-config:test',
      'hermes:connection-config:probe',
      'hermes:connection-config:oauth-login',
      'hermes:connection-config:oauth-logout',
      'hermes:connection-config:save',
      'hermes:connection-config:apply',
      'hermes:ssh-config:hosts',
      'hermes:ssh-config:resolve',
      'hermes:cloud:status',
      'hermes:cloud:login',
      'hermes:cloud:logout',
      'hermes:cloud:discover',
      'hermes:cloud:agent-sign-in'
    ],
    kind: 'handle',
    privilege: 'connection-config'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:profile:get', 'hermes:profile:set'],
    kind: 'handle',
    privilege: 'profile-runtime'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:connectors:key:status',
      'hermes:connectors:key:save',
      'hermes:connectors:key:remove',
      'hermes:connectors:catalog',
      'hermes:connectors:categories',
      'hermes:connectors:connections',
      'hermes:connectors:authorize',
      'hermes:connectors:poll',
      'hermes:connectors:disconnect',
      'hermes:connectors:sync'
    ],
    kind: 'handle',
    privilege: 'connector-credentials'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:orgo-desktop:config:get',
      'hermes:orgo-desktop:config:save',
      'hermes:orgo-desktop:session',
      'hermes:orgo-desktop:key:save',
      'hermes:orgo-desktop:status',
      'hermes:orgo-desktop:provision',
      'hermes:orgo-desktop:tailscale:local-status',
      'hermes:orgo-desktop:tailscale:local-open',
      'hermes:orgo-desktop:tailscale:begin',
      'hermes:orgo-desktop:tailscale:status',
      'hermes:orgo-desktop:tailscale:connect',
      'hermes:orgo-desktop:ensure-running',
      'hermes:orgo-desktop:doctor',
      'hermes:orgo-desktop:sync',
      'hermes:orgo-desktop:workspaces',
      'hermes:orgo-desktop:computers'
    ],
    kind: 'handle',
    privilege: 'host-integration'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:data-url-read-max:get',
      'hermes:data-url-read-max:set',
      'hermes:readFileDataUrl',
      'hermes:readFileDataUrlForAttach',
      'hermes:readFileText',
      'hermes:selectPaths',
      'hermes:selectSavePath',
      'hermes:saveImageFromUrl',
      'hermes:saveImageBuffer',
      'hermes:saveClipboardImage',
      'hermes:normalizePreviewTarget',
      'hermes:watchPreviewFile',
      'hermes:watchDirectory',
      'hermes:stopPreviewFileWatch',
      'hermes:setting:defaultProjectDir:get',
      'hermes:setting:defaultProjectDir:set',
      'hermes:setting:defaultProjectDir:pick',
      'hermes:workspace:sanitize',
      'hermes:logs:reveal',
      'hermes:logs:recent',
      'hermes:fs:readDir',
      'hermes:fs:gitRoot',
      'hermes:fs:reveal',
      'hermes:fs:openDir',
      'hermes:fs:desktopPluginsRoot',
      'hermes:fs:agentPluginsRoot',
      'hermes:fs:rename',
      'hermes:fs:writeText',
      'hermes:fs:trash'
    ],
    kind: 'handle',
    privilege: 'filesystem'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:git:worktreeList',
      'hermes:git:worktreeAdd',
      'hermes:git:worktreeRemove',
      'hermes:git:branchSwitch',
      'hermes:git:branchList',
      'hermes:git:baseBranchList',
      'hermes:git:repoStatus',
      'hermes:git:review:list',
      'hermes:git:review:diff',
      'hermes:git:fileDiff',
      'hermes:git:review:stage',
      'hermes:git:review:unstage',
      'hermes:git:review:revert',
      'hermes:git:review:revParse',
      'hermes:git:review:commit',
      'hermes:git:review:commitContext',
      'hermes:git:review:push',
      'hermes:git:review:shipInfo',
      'hermes:git:review:prList',
      'hermes:git:review:fetchPrComment',
      'hermes:git:review:createPr',
      'hermes:git:scanRepos'
    ],
    kind: 'handle',
    privilege: 'git'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:terminal:start',
      'hermes:terminal:write',
      'hermes:terminal:resize',
      'hermes:terminal:cwd',
      'hermes:terminal:dispose'
    ],
    kind: 'handle',
    privilege: 'terminal'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:updates:check',
      'hermes:updates:apply',
      'hermes:updates:branch:get',
      'hermes:updates:branch:set'
    ],
    kind: 'handle',
    privilege: 'update'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:uninstall:summary', 'hermes:uninstall:run'],
    kind: 'handle',
    privilege: 'uninstall'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:openExternal', 'hermes:openPreviewInBrowser'],
    kind: 'handle',
    privilege: 'external-open'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:requestMicrophoneAccess', 'hermes:window:readBelow'],
    kind: 'handle',
    privilege: 'permission'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:readClipboard', 'hermes:writeClipboard'],
    kind: 'handle',
    privilege: 'clipboard'
  },
  {
    capabilities: PRIMARY,
    channels: [
      'hermes:fetchLinkTitle',
      'hermes:vscode-theme:fetch',
      'hermes:vscode-theme:search',
      'hermes:deep-link-ready'
    ],
    kind: 'handle',
    privilege: 'host-integration'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:notify'],
    kind: 'handle',
    privilege: 'notification'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:window:openSession', 'hermes:window:openInstance'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: PRIMARY_AND_SESSION,
    channels: ['hermes:pet-overlay:open'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: Object.freeze(['primary', 'session', 'pet-overlay'] as const),
    channels: ['hermes:pet-overlay:close'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: PET_OVERLAY,
    channels: [
      'hermes:pet-overlay:set-bounds',
      'hermes:pet-overlay:ignore-mouse',
      'hermes:pet-overlay:set-focusable',
      'hermes:pet-overlay:control'
    ],
    kind: 'on',
    privilege: 'window-control'
  },
  {
    capabilities: PRIMARY_AND_SESSION,
    channels: ['hermes:pet-overlay:state'],
    kind: 'on',
    privilege: 'renderer-safe'
  },
  {
    capabilities: PRIMARY_AND_SESSION,
    channels: ['hermes:hud:open'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:hud:close'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: HUD,
    channels: ['hermes:hud:vibrancy'],
    kind: 'handle',
    privilege: 'window-control'
  },
  {
    capabilities: HUD,
    channels: ['hermes:hud:ignore-mouse', 'hermes:hud:move-by', 'hermes:hud:set-bounds', 'hermes:hud:session'],
    kind: 'on',
    privilege: 'window-control'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:quick-entry:settings:get', 'hermes:quick-entry:settings:set'],
    kind: 'handle',
    privilege: 'host-integration'
  },
  {
    capabilities: QUICK_ENTRY,
    channels: ['hermes:quick-entry:submit', 'hermes:quick-entry:dismiss'],
    kind: 'on',
    privilege: 'renderer-safe'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:quick-entry:state'],
    kind: 'on',
    privilege: 'renderer-safe'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:find-in-page', 'hermes:stop-find-in-page', 'hermes:zoom:get'],
    kind: 'handle',
    privilege: 'renderer-safe'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:zoom:set-percent', 'hermes:active-work'],
    kind: 'on',
    privilege: 'renderer-safe'
  },
  {
    capabilities: ALL_WINDOWS,
    channels: ['hermes:get-remote-display-reason', 'hermes:power-battery:get', 'hermes:version'],
    kind: 'handle',
    privilege: 'renderer-safe'
  },
  {
    capabilities: CHAT,
    channels: ['hermes:ambient:claim'],
    kind: 'handle',
    privilege: 'renderer-safe'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:wake-indicator:get'],
    kind: 'handle',
    privilege: 'renderer-safe'
  },
  {
    capabilities: PRIMARY,
    channels: ['hermes:wake-indicator:set', 'hermes:translucency', 'hermes:keep-awake'],
    kind: 'on',
    privilege: 'host-integration'
  },
  {
    capabilities: PRIMARY_AND_SESSION,
    channels: ['hermes:previewShortcutActive'],
    kind: 'on',
    privilege: 'renderer-safe'
  },
  {
    capabilities: ALL_WINDOWS,
    channels: ['hermes:titlebar-theme', 'hermes:native-theme', 'hermes:logs:renderer-error'],
    kind: 'on',
    privilege: 'renderer-safe'
  }
]

function buildPolicy(groups: readonly PolicyGroup[]): IpcChannelPolicy {
  const policy: Record<string, IpcChannelRule> = Object.create(null)

  for (const group of groups) {
    if (
      PRIMARY_ONLY_PRIVILEGE_SET.has(group.privilege) &&
      (group.capabilities.length !== 1 || group.capabilities[0] !== 'primary')
    ) {
      throw new Error(`Host-impact IPC privilege must be primary-only: ${group.privilege}`)
    }

    for (const channel of group.channels) {
      if (Object.hasOwn(policy, channel)) {
        throw new Error(`Duplicate IPC policy channel: ${channel}`)
      }

      if (channel.includes('*')) {
        throw new Error(`Wildcard IPC policy channel is forbidden: ${channel}`)
      }

      policy[channel] = Object.freeze({
        capabilities: group.capabilities,
        kind: group.kind,
        privilege: group.privilege
      })
    }
  }

  return Object.freeze(policy)
}

export const IPC_CHANNEL_POLICY = buildPolicy(GROUPS)

export const RENDERER_ORIGINATED_IPC_CHANNELS = Object.freeze(Object.keys(IPC_CHANNEL_POLICY).sort())
