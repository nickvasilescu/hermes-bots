import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  beginOrgoTailscaleSetup,
  BOT_ORGO_LEGACY_WORKSPACE_NAME,
  BOT_ORGO_WORKSPACE_NAME,
  BOT_REMOTE_HERMES_REF,
  buildOrgoAgentMcpInstallCommands,
  buildOrgoAgentMcpProbeCommand,
  buildOrgoWallpaperApplyCommand,
  buildOrgoWallpaperInstallCommands,
  createOrgoComputer,
  doctorOrgoComputer,
  ensureHermesInstalledOnOrgo,
  ensureOrgoAgentMcpServer,
  ensureOrgoComputerRunning,
  ensureOrgoDesktopWallpaper,
  extractTailscaleAuthUrl,
  findOrCreateOrgoWorkspace,
  findOrCreateSharedHermesComputer,
  listOrgoComputers,
  listOrgoInventory,
  listOrgoWorkspaces,
  ORGO_AGENT_MCP_REMOTE_PATH,
  ORGO_AGENT_MCP_SERVER_NAME,
  ORGO_AGENT_MCP_STAGING_PATH,
  ORGO_AGENT_MCP_UPLOAD_CHUNK_SIZE,
  ORGO_SILK_WALLPAPER_PATH,
  ORGO_WALLPAPER_PROBE_COMMAND,
  ORGO_WALLPAPER_STAGING_PATH,
  ORGO_WALLPAPER_UPLOAD_CHUNK_SIZE,
  orgoAgentMcpEntry,
  orgoMcpEntries,
  orgoMcpEntry,
  orgoProcessEnv,
  parseTailscaleStatus,
  persistOrgoEnvironmentOnRemote,
  pickOrgoWorkspaceByName,
  pickSharedHermesComputer,
  resolveHermesAgentTemplateRef,
  resolveOrgoAgentMcpAssetPath,
  TAILSCALE_AUTH_LOG_PATH,
  TAILSCALE_AUTH_POLL_COMMAND,
  TAILSCALE_INSTALL_TIMEOUT_SECONDS,
  TAILSCALE_STATUS_SUMMARY_URL
} from './orgo-broker'
import { BOT_TEMPLATE_REF } from './product'

const COMPUTER_ID = 'ef2f6e29-3864-494b-a82c-15280c5d9f9e'
const WORKSPACE_ID = 'ws-shared'

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

async function withDesktopProduct<T>(product: 'bot' | 'hermes', run: () => Promise<T>): Promise<T> {
  const previous = process.env.HERMES_DESKTOP_PRODUCT
  process.env.HERMES_DESKTOP_PRODUCT = product

  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete process.env.HERMES_DESKTOP_PRODUCT
    } else {
      process.env.HERMES_DESKTOP_PRODUCT = previous
    }
  }
}

const withBotProduct = <T>(run: () => Promise<T>) => withDesktopProduct('bot', run)
const withHermesProduct = <T>(run: () => Promise<T>) => withDesktopProduct('hermes', run)

test('MCP entry references the process env instead of copying the API key', () => {
  const entry = orgoMcpEntry(COMPUTER_ID)

  assert.equal(entry.trust, 'untrusted')
  assert.equal(entry.env.ORGO_API_KEY, '${env:ORGO_API_KEY}')
  assert.equal(entry.env.ORGO_DEFAULT_COMPUTER_ID, COMPUTER_ID)
  assert.equal(entry.command, 'npx')
  assert.deepEqual(orgoProcessEnv({ apiKey: 'orgo-secret', computerId: COMPUTER_ID }), {
    ORGO_API_KEY: 'orgo-secret',
    ORGO_DEFAULT_COMPUTER_ID: COMPUTER_ID
  })
})

test('delegated Orgo agent MCP entry is pinned to the provisioned computer', () => {
  const entry = orgoAgentMcpEntry(COMPUTER_ID)

  assert.equal(entry.trust, 'untrusted')
  assert.equal(entry.command, '/usr/local/lib/hermes-agent/venv/bin/python')
  assert.deepEqual(entry.args, [ORGO_AGENT_MCP_REMOTE_PATH])
  assert.equal(entry.env.ORGO_API_KEY, '${env:ORGO_API_KEY}')
  assert.equal(entry.env.ORGO_DEFAULT_COMPUTER_ID, COMPUTER_ID)
  assert.equal(entry.env.ORGO_AGENT_MAX_STEPS, '30')
  assert.equal(entry.timeout, 960)
})

test('delegated Orgo agent server is bundled from the Hermes source tree in development', () => {
  assert.match(resolveOrgoAgentMcpAssetPath(process.cwd()) || '', /hermes_cli\/orgo_agent_mcp\.py$/)
})

test('every synced profile receives low-level and delegated Orgo MCP servers', () => {
  const entries = orgoMcpEntries(COMPUTER_ID)

  assert.deepEqual(Object.keys(entries).sort(), ['orgo', ORGO_AGENT_MCP_SERVER_NAME].sort())
  assert.equal(entries.orgo?.env.ORGO_DEFAULT_COMPUTER_ID, COMPUTER_ID)
  assert.equal(entries[ORGO_AGENT_MCP_SERVER_NAME]?.env.ORGO_DEFAULT_COMPUTER_ID, COMPUTER_ID)
})

test('delegated Orgo agent server upload is chunked and installed atomically', () => {
  const commands = buildOrgoAgentMcpInstallCommands(Buffer.alloc(ORGO_AGENT_MCP_UPLOAD_CHUNK_SIZE).toString('base64'))
  const finalCommand = commands.at(-1) || ''
  const encodedScript = finalCommand.match(/printf %s "([^"]+)" \| base64 -d \| python3/)?.[1] || ''
  const script = Buffer.from(encodedScript, 'base64').toString('utf8')

  assert.equal(commands.length > 3, true)
  assert.match(commands[0] || '', new RegExp(ORGO_AGENT_MCP_STAGING_PATH))
  assert.match(script, new RegExp(ORGO_AGENT_MCP_REMOTE_PATH))
  assert.match(script, /os\.replace\(temporary, target\)/)
})

test('delegated Orgo agent server skips upload when its hash matches', async () => {
  const commands: string[] = []
  const serverBytes = Buffer.from('print("server")')

  const expectedProbe = buildOrgoAgentMcpProbeCommand(
    'ff005961596f9819dc9b55356b9abebabbd866adf2a359a02b1491b2c42baa24'
  )

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    return json({ success: true, exit_code: 0, output: 'ready' })
  }) as typeof fetch

  const result = await ensureOrgoAgentMcpServer('orgo-secret', COMPUTER_ID, () => serverBytes, fetchImpl)

  assert.equal(result.installedNow, false)
  assert.deepEqual(commands, [expectedProbe])
})

test('delegated Orgo agent server uploads and verifies when missing', async () => {
  const commands: string[] = []
  let probeCount = 0

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    if (command.includes(`sha256sum ${ORGO_AGENT_MCP_REMOTE_PATH}`)) {
      probeCount += 1

      return probeCount === 1
        ? json({ success: false, exit_code: 1, output: 'missing' })
        : json({ success: true, exit_code: 0, output: 'verified' })
    }

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  const result = await ensureOrgoAgentMcpServer(
    'orgo-secret',
    COMPUTER_ID,
    () => Buffer.from('print("server")'),
    fetchImpl
  )

  assert.equal(result.installedNow, true)
  assert.equal(probeCount, 2)
  assert.match(commands[1] || '', new RegExp(ORGO_AGENT_MCP_STAGING_PATH))
  assert.match(commands[2] || '', new RegExp(`>> ${ORGO_AGENT_MCP_STAGING_PATH}`))
  assert.match(commands[3] || '', /\| base64 -d \| python3/)
})

test('delegated Orgo agent server removes staging data after an upload failure', async () => {
  const commands: string[] = []

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    if (command.includes(`sha256sum ${ORGO_AGENT_MCP_REMOTE_PATH}`)) {
      return json({ success: false, exit_code: 1, output: 'missing' })
    }

    if (command.startsWith('printf %s') && command.includes(`>> ${ORGO_AGENT_MCP_STAGING_PATH}`)) {
      return json({ success: false, exit_code: 1, output: 'write failed' })
    }

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  await assert.rejects(
    ensureOrgoAgentMcpServer('orgo-secret', COMPUTER_ID, () => Buffer.from('server'), fetchImpl),
    /write failed/
  )
  assert.equal(commands.at(-1), `rm -f ${ORGO_AGENT_MCP_STAGING_PATH}`)
})

test('lists workspaces and computers without exposing the key in parsed results', async () => {
  const calls: string[] = []

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)

    if (url.endsWith('/workspaces')) {
      return json({ workspaces: [{ id: WORKSPACE_ID, name: 'Bots' }] })
    }

    if (url.endsWith(`/workspaces/${WORKSPACE_ID}`)) {
      return json({
        id: WORKSPACE_ID,
        name: 'Bots',
        desktops: [{ id: COMPUTER_ID, name: 'Shared', status: 'stopped', workspace_id: WORKSPACE_ID }]
      })
    }

    return json({}, 404)
  }) as typeof fetch

  const workspaces = await listOrgoWorkspaces('orgo-secret', fetchImpl)
  const computers = await listOrgoComputers('orgo-secret', WORKSPACE_ID, fetchImpl)

  assert.deepEqual(workspaces, [{ id: WORKSPACE_ID, name: 'Bots', status: undefined }])
  assert.equal(computers[0]?.id, COMPUTER_ID)
  assert.equal(JSON.stringify(computers).includes('orgo-secret'), false)
  assert.equal(calls.some(url => url.includes('/computers')), false)
})

test('lists the full authorized Orgo inventory and backfills computer workspace IDs', async () => {
  const secondWorkspaceId = 'ws-client'
  const secondComputerId = '60fe709b-1837-476c-87c0-12e74575c94b'
  const calls: string[] = []

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)

    if (url.endsWith('/workspaces')) {
      return json({
        workspaces: [
          {
            id: WORKSPACE_ID,
            name: 'Shared',
            computers: [{ id: COMPUTER_ID, name: 'Operations', status: 'running' }]
          },
          { id: secondWorkspaceId, name: 'Client' }
        ]
      })
    }

    if (url.endsWith(`/workspaces/${secondWorkspaceId}`)) {
      return json({
        id: secondWorkspaceId,
        name: 'Client',
        computers: [{ id: secondComputerId, name: 'Research', status: 'stopped' }]
      })
    }

    return json({}, 404)
  }) as typeof fetch

  const inventory = await listOrgoInventory('orgo-secret', fetchImpl)

  assert.deepEqual(inventory.workspaces.map(workspace => workspace.name), ['Shared', 'Client'])
  assert.deepEqual(
    inventory.computers.map(computer => [computer.name, computer.workspaceId]),
    [
      ['Research', secondWorkspaceId],
      ['Operations', WORKSPACE_ID]
    ]
  )
  assert.deepEqual(calls, [
    'https://www.orgo.ai/api/workspaces',
    `https://www.orgo.ai/api/workspaces/${secondWorkspaceId}`
  ])
  assert.equal(JSON.stringify(inventory).includes('orgo-secret'), false)
})

test('reuses dedicated Korgo Bot and legacy Hermes Bots workspaces', () => {
  const workspaces = [
    { id: 'first', name: 'Existing project' },
    { id: WORKSPACE_ID, name: ' korgo bot ' },
    { id: 'legacy', name: ' hermes bots ' }
  ]

  assert.equal(pickOrgoWorkspaceByName(workspaces, BOT_ORGO_WORKSPACE_NAME)?.id, WORKSPACE_ID)
  assert.equal(pickOrgoWorkspaceByName(workspaces, BOT_ORGO_LEGACY_WORKSPACE_NAME)?.id, 'legacy')
  assert.equal(pickOrgoWorkspaceByName(workspaces, 'Missing'), undefined)
})

test('recovers the legacy workspace when create races an existing resource', async () => {
  let listCalls = 0
  let createCalls = 0

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/workspaces') && init?.method === 'POST') {
      createCalls += 1

      return json({ detail: 'workspace name already exists' }, 409)
    }

    if (url.endsWith('/workspaces')) {
      listCalls += 1

      return listCalls === 1
        ? json({ projects: [] })
        : json({ projects: [{ id: WORKSPACE_ID, name: 'Hermes Bots' }] })
    }

    return json({}, 404)
  }) as typeof fetch

  const workspace = await findOrCreateOrgoWorkspace(
    'orgo-secret',
    BOT_ORGO_WORKSPACE_NAME,
    [BOT_ORGO_LEGACY_WORKSPACE_NAME],
    fetchImpl
  )

  assert.equal(workspace.id, WORKSPACE_ID)
  assert.equal(listCalls, 2)
  assert.equal(createCalls, 1)
})

test('creates a computer from the curated template', async () => {
  let body = ''

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    body = String(init?.body || '')

    return json({ id: COMPUTER_ID, name: 'Shared computer', status: 'creating' })
  }) as typeof fetch

  const computer = await createOrgoComputer('orgo-secret', { workspaceId: WORKSPACE_ID }, fetchImpl)
  assert.equal(computer.id, COMPUTER_ID)
  assert.match(body, /system\/hermes-agent@1\.0\.0/)
})

test('reuses the canonical shared computer when workspace summaries omit template metadata', () => {
  const computer = pickSharedHermesComputer(
    [
      {
        id: COMPUTER_ID,
        name: 'Shared computer',
        status: 'running'
      }
    ],
    BOT_TEMPLATE_REF
  )

  assert.equal(computer?.id, COMPUTER_ID)
})

test('recovers the shared computer when create returns a duplicate-name conflict', async () => {
  let listCalls = 0
  let createCalls = 0

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/computers') && init?.method === 'POST') {
      createCalls += 1

      return json({ detail: 'computer name already exists' }, 409)
    }

    if (url.endsWith(`/workspaces/${WORKSPACE_ID}`)) {
      listCalls += 1

      return listCalls === 1
        ? json({ id: WORKSPACE_ID, name: BOT_ORGO_WORKSPACE_NAME, desktops: [] })
        : json({
            id: WORKSPACE_ID,
            name: BOT_ORGO_WORKSPACE_NAME,
            desktops: [{ id: COMPUTER_ID, name: 'Shared computer', status: 'running' }]
          })
    }

    return json({}, 404)
  }) as typeof fetch

  const computer = await findOrCreateSharedHermesComputer(
    'orgo-secret',
    { workspaceId: WORKSPACE_ID, name: 'Shared computer', templateRef: BOT_TEMPLATE_REF },
    fetchImpl
  )

  assert.equal(computer.id, COMPUTER_ID)
  assert.equal(listCalls, 2)
  assert.equal(createCalls, 1)
})

test('pins the Bot product to its tested Orgo template', async () => {
  let requested = false

  const result = await withBotProduct(() =>
    resolveHermesAgentTemplateRef('orgo-secret', (async () => {
      requested = true

      return json({ templates: [{ ref: 'system/hermes-agent@9.9.9' }] })
    }) as typeof fetch)
  )

  assert.equal(result, BOT_TEMPLATE_REF)
  assert.equal(requested, false)
})

test('ensure-running starts a stopped computer then waits for running', async () => {
  const statuses = ['stopped', 'starting', 'running']

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)

    if (url.endsWith('/start')) {
      return json({ success: true })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: statuses.shift() || 'running' })
  }) as typeof fetch

  const computer = await ensureOrgoComputerRunning('orgo-secret', COMPUTER_ID, fetchImpl, async () => undefined)
  assert.equal(computer.status, 'running')
})

test('doctor reports auth, status, and VNC readiness', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)

    if (url.endsWith('/start')) {
      return json({ success: true })
    }

    if (url.endsWith('/vnc-password')) {
      return json({ password: 'vncsecret' })
    }

    if (url.endsWith('/bash')) {
      return json({ success: true, exit_code: 0, output: 'hermes 0.17.0' })
    }

    return json({
      id: COMPUTER_ID,
      name: 'Shared',
      status: 'running',
      instance_id: '8b517302'
    })
  }) as typeof fetch

  const result = await doctorOrgoComputer('orgo-secret', COMPUTER_ID, fetchImpl)
  assert.equal(result.ok, true)
  assert.equal(result.apiAuth, true)
  assert.equal(result.vncAvailable, true)
  assert.equal(result.mcpReady, true)
  assert.equal(result.hermesInstalled, true)
})

test('installs Hermes on a computer that does not have it yet', async () => {
  const commands: string[] = []

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    let versionProbes = 0

    if (url.endsWith('/bash')) {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string }
      const command = String(body.command || '')
      commands.push(command)

      if (command.includes('hermes --version')) {
        versionProbes = commands.filter(item => item.includes('hermes --version')).length

        if (versionProbes === 1) {
          return json({ success: true, exit_code: 127, output: 'hermes: not found' })
        }

        return json({ success: true, exit_code: 0, output: 'hermes 0.17.0' })
      }

      if (command.includes('install.sh')) {
        return json({ success: true, exit_code: 0, output: 'Hermes installed' })
      }
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  const result = await withHermesProduct(() =>
    ensureHermesInstalledOnOrgo('orgo-secret', COMPUTER_ID, fetchImpl)
  )

  assert.equal(result.installed, true)
  assert.equal(result.installedNow, true)
  assert.equal(commands.some(command => command.includes('install.sh')), true)
})

test('does not install an unpinned latest Hermes build in the Bot product', async () => {
  const commands: string[] = []

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/bash')) {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string }
      commands.push(String(body.command || ''))

      return json({ success: true, exit_code: 127, output: 'hermes: not found' })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  await assert.rejects(
    () => withBotProduct(() => ensureHermesInstalledOnOrgo('orgo-secret', COMPUTER_ID, fetchImpl)),
    /will not install an unpinned Hermes build/
  )
  assert.equal(commands.some(command => command.includes('install.sh')), false)
})

test('skips the installer when Hermes is already on PATH', async () => {
  const commands: string[] = []

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/bash')) {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string }
      commands.push(String(body.command || ''))

      return json({ success: true, exit_code: 0, output: 'hermes 0.17.0' })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  const result = await ensureHermesInstalledOnOrgo('orgo-secret', COMPUTER_ID, fetchImpl)
  assert.equal(result.installedNow, false)
  assert.equal(commands.some(command => command.includes('install.sh')), false)
})

test('updates an incompatible Bot backend to the pinned SSH-compatible revision', async () => {
  const commands: string[] = []
  let updated = false
  let updateTimeout = 0

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/bash')) {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string; timeout?: number }
      const command = String(body.command || '')
      commands.push(command)

      if (command.includes('git -C "$project" fetch')) {
        updated = true
        updateTimeout = Number(body.timeout || 0)

        return json({ success: true, exit_code: 0, output: 'Updated pinned Hermes backend' })
      }

      if (command.includes('ssh-session-token-file')) {
        return json({ success: true, exit_code: updated ? 0 : 1, output: updated ? 'compatible' : 'incompatible' })
      }

      return json({ success: true, exit_code: 0, output: 'Hermes Agent v0.16.0' })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  const result = await withBotProduct(() =>
    ensureHermesInstalledOnOrgo('orgo-secret', COMPUTER_ID, fetchImpl)
  )

  assert.equal(result.updatedNow, true)
  assert.equal(updateTimeout, 180)
  assert.equal(commands.some(command => command.includes(BOT_REMOTE_HERMES_REF)), true)
  assert.equal(commands.some(command => command.includes('pip install')), true)
})

test('uses Orgo curated Hermes template and does not reinstall on that snapshot', async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/templates/global')) {
      return json({
        templates: [
          { ref: 'system/claude-code@1.0.0' },
          { ref: 'system/hermes-agent@1.0.0' },
          { ref: 'system/hermes-agent@1.1.0' }
        ]
      })
    }

    if (url.endsWith('/bash')) {
      assert.equal(String(init?.body || '').includes('install.sh'), false)

      return json({ success: true, exit_code: 127, output: 'not on PATH yet' })
    }

    return json({
      id: COMPUTER_ID,
      name: 'Shared',
      status: 'running',
      instance_id: '8b517302',
      template_ref: 'system/hermes-agent@1.0.0'
    })
  }) as typeof fetch

  assert.equal(
    await withHermesProduct(() => resolveHermesAgentTemplateRef('orgo-secret', fetchImpl)),
    'system/hermes-agent@1.1.0'
  )
  assert.equal(
    pickSharedHermesComputer([
      { id: 'aaaaaaaa-3864-494b-a82c-15280c5d9f9e', name: 'Claude', status: 'running', templateRef: 'system/claude-code@1.0.0' },
      { id: COMPUTER_ID, name: 'Hermes', status: 'running', templateRef: 'system/hermes-agent@1.0.0' }
    ])?.id,
    COMPUTER_ID
  )
  assert.equal(
    pickSharedHermesComputer(
      [{ id: COMPUTER_ID, name: 'Newer Hermes', status: 'running', templateRef: 'system/hermes-agent@1.1.0' }],
      BOT_TEMPLATE_REF
    ),
    undefined
  )

  const result = await ensureHermesInstalledOnOrgo('orgo-secret', COMPUTER_ID, fetchImpl)
  assert.equal(result.fromTemplate, true)
  assert.equal(result.installedNow, false)
  assert.equal(result.installed, true)
})

test('parses Tailscale status and one-time login URLs', () => {
  assert.deepEqual(
    parseTailscaleStatus(
      JSON.stringify({
        BackendState: 'Running',
        Self: { DNSName: 'hermes-bots-ef2f6e29.example.ts.net.', Online: true }
      })
    ),
    {
      installed: true,
      connected: true,
      dnsName: 'hermes-bots-ef2f6e29.example.ts.net',
      backendState: 'Running',
      authUrl: ''
    }
  )
  assert.equal(
    extractTailscaleAuthUrl('To authenticate, visit: https://login.tailscale.com/a/abc_123'),
    'https://login.tailscale.com/a/abc_123'
  )
})

test('starts Tailscale and returns the VM authorization challenge', async () => {
  const commands: string[] = []
  const installTimeouts: number[] = []

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/bash')) {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string; timeout?: number }
      const command = String(body.command || '')
      commands.push(command)

      if (command.includes('nohup tailscale up')) {
        return json({ success: true, exit_code: 0, output: 'started' })
      }

      if (command === TAILSCALE_AUTH_POLL_COMMAND) {
        return json({
          success: true,
          exit_code: 0,
          output: '{"BackendState":"NeedsLogin"}\nhttps://login.tailscale.com/a/setup123'
        })
      }

      if (command.includes('tailscale.com/install.sh')) {
        installTimeouts.push(Number(body.timeout))

        if (installTimeouts.length === 1) {
          return json({ success: false, exit_code: 1, output: 'context canceled' })
        }
      }

      if (command.includes('tailscale status')) {
        return json({ success: true, exit_code: 0, output: '{"BackendState":"NeedsLogin"}' })
      }

      return json({ success: true, exit_code: 0, output: '' })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  const status = await beginOrgoTailscaleSetup('orgo-secret', COMPUTER_ID, fetchImpl, async () => undefined)
  assert.equal(status.authUrl, 'https://login.tailscale.com/a/setup123')
  assert.equal(commands.some(command => command.includes('command -v tailscaled')), true)
  assert.equal(commands.some(command => command.includes('/usr/sbin/tailscaled')), true)
  assert.equal(commands.some(command => command.includes('--tun=userspace-networking')), true)
  assert.equal(commands.some(command => command.includes('--ssh')), true)
  assert.equal(commands.some(command => command.includes('nohup tailscale up --json --ssh')), true)
  assert.equal(commands.some(command => command.includes("pkill -f '^tailscale (up|login)( |$)'")), true)
  assert.equal(commands.some(command => command.includes(TAILSCALE_AUTH_LOG_PATH)), true)
  assert.equal(commands.some(command => command.includes('timeout 12s tailscale up')), false)
  assert.equal(commands.some(command => command.includes('timeout 3s tailscale status')), true)
  assert.equal(commands.some(command => command.includes('pkill -x tailscaled')), true)
  assert.equal(commands.some(command => command.includes('nohup "$tailscaled_bin"')), true)
  assert.deepEqual(installTimeouts, [TAILSCALE_INSTALL_TIMEOUT_SECONDS, TAILSCALE_INSTALL_TIMEOUT_SECONDS])
})

test('waits for one authorization process instead of starting competing logins', async () => {
  const commands: string[] = []
  let pollCount = 0

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/bash')) {
      const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
      commands.push(command)

      if (command.includes('nohup tailscale up')) {
        return json({ success: true, exit_code: 0, output: 'started' })
      }

      if (command === TAILSCALE_AUTH_POLL_COMMAND) {
        pollCount += 1

        return pollCount === 13
          ? json({
              success: true,
              exit_code: 0,
              output: '{"BackendState":"NeedsLogin"}\nhttps://login.tailscale.com/a/delayed123'
            })
          : json({ success: true, exit_code: 0, output: '{"BackendState":"NeedsLogin"}' })
      }

      if (command.includes('tailscale status')) {
        return json({ success: true, exit_code: 0, output: '{"BackendState":"NeedsLogin"}' })
      }

      return json({ success: true, exit_code: 0, output: '' })
    }

    return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
  }) as typeof fetch

  const status = await beginOrgoTailscaleSetup('orgo-secret', COMPUTER_ID, fetchImpl, async () => undefined)
  assert.equal(status.authUrl, 'https://login.tailscale.com/a/delayed123')
  assert.equal(pollCount, 13)
  assert.equal(commands.filter(command => command.includes(`rm -f ${TAILSCALE_AUTH_LOG_PATH}`)).length, 1)
  assert.equal(commands.some(command => command.includes('tailscale up --json --ssh')), true)
  assert.equal(commands.some(command => command.includes('--force-reauth')), false)
  assert.equal(commands.some(command => command.includes('timeout 12s')), false)
})

test('reports a missing Tailscale authorization URL instead of silently stalling', async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith('/bash')) {
      return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
    }

    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')

    if (command === TAILSCALE_AUTH_POLL_COMMAND) {
      return json({ success: true, exit_code: 0, output: '{"BackendState":"NeedsLogin","AuthURL":""}' })
    }

    return json({ success: true, exit_code: 0, output: command.includes('nohup tailscale up') ? 'started' : '' })
  }) as typeof fetch

  await assert.rejects(
    beginOrgoTailscaleSetup('orgo-secret', COMPUTER_ID, fetchImpl, async () => undefined),
    error => {
      assert.match(String(error), /Tailscale registration did not return a sign-in link/)
      assert.equal(String(error).includes('"BackendState"'), false)
      assert.equal(String(error).length < 240, true)

      return true
    }
  )
})

test('reports a live Tailscale coordination outage without blaming the user plan', async () => {
  let statusRequestHadAuthorization = false

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url === TAILSCALE_STATUS_SUMMARY_URL) {
      statusRequestHadAuthorization = new Headers(init?.headers).has('Authorization')

      return json({
        components: [{ name: 'Coordination service', status: 'partial_outage' }]
      })
    }

    if (!url.endsWith('/bash')) {
      return json({ id: COMPUTER_ID, name: 'Shared', status: 'running', instance_id: '8b517302' })
    }

    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')

    return json({
      success: true,
      exit_code: 0,
      output:
        command === TAILSCALE_AUTH_POLL_COMMAND
          ? '{"BackendState":"NeedsLogin","AuthURL":""}'
          : command.includes('nohup tailscale up')
            ? 'started'
            : ''
    })
  }) as typeof fetch

  await assert.rejects(
    beginOrgoTailscaleSetup('orgo-secret', COMPUTER_ID, fetchImpl, async () => undefined),
    error => {
      assert.match(String(error), /currently reporting a coordination-service outage/)
      assert.match(String(error), /not related to your Tailscale plan/)
      assert.match(String(error), /status\.tailscale\.com/)

      return true
    }
  )
  assert.equal(statusRequestHadAuthorization, false)
})

test('writes the Orgo key to the remote secret env rather than MCP config', async () => {
  let command = ''

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  await persistOrgoEnvironmentOnRemote('orgo-secret', COMPUTER_ID, fetchImpl)
  assert.match(command, /ORGO_API_KEY/)
  assert.equal(command.includes('orgo-secret'), false)
  assert.match(command, /chmod/)
})

test('wallpaper probe checks the silk asset md5 before installing', () => {
  assert.match(ORGO_WALLPAPER_PROBE_COMMAND, /desktop-silk-wallpaper\.png/)
  assert.match(ORGO_WALLPAPER_PROBE_COMMAND, /7febc8b0943cddc162bb544de31008bb/)
})

test('wallpaper apply command supports GNOME, XFCE, and PCManFM desktops', () => {
  const command = buildOrgoWallpaperApplyCommand()

  assert.match(command, new RegExp(ORGO_SILK_WALLPAPER_PATH.replace(/\//g, '\\/')))
  assert.match(command, /picture-options 'scaled'/)
  assert.match(command, /xfconf-query -c xfce4-desktop/)
  assert.match(command, /xfdesktop --reload/)
  assert.match(command, /pcmanfm --set-wallpaper/)
})

test('wallpaper install stages bounded chunks and writes both target paths', () => {
  const commands = buildOrgoWallpaperInstallCommands('aGVsbG8=')
  const finalCommand = commands.at(-1) || ''
  const encodedScript = finalCommand.match(/printf %s "([^"]+)" \| base64 -d \| python3/)?.[1] || ''
  const script = Buffer.from(encodedScript, 'base64').toString('utf8')

  assert.equal(commands.length, 3)
  assert.match(commands[0] || '', new RegExp(ORGO_WALLPAPER_STAGING_PATH))
  assert.match(commands[1] || '', /aGVsbG8=/)
  assert.match(script, /desktop-silk-wallpaper\.png/)
  assert.match(script, /orgo-background\.png/)
})

test('wallpaper upload commands stay below the Orgo request limit', () => {
  const commands = buildOrgoWallpaperInstallCommands(Buffer.alloc(944_614).toString('base64'))
  const chunkCommands = commands.slice(1, -1)

  assert.equal(chunkCommands.length > 1, true)
  assert.equal(
    chunkCommands.every(command => command.length <= ORGO_WALLPAPER_UPLOAD_CHUNK_SIZE + 128),
    true
  )
})

test('ensureOrgoDesktopWallpaper skips upload when the silk asset is already present', async () => {
  const commands: string[] = []

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    if (command === ORGO_WALLPAPER_PROBE_COMMAND) {
      return json({ success: true, exit_code: 0, output: '' })
    }

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  const result = await ensureOrgoDesktopWallpaper('orgo-secret', COMPUTER_ID, () => Buffer.from('unused'), fetchImpl)

  assert.equal(result.installedNow, false)
  assert.equal(result.applied, true)
  assert.equal(commands.length, 2)
  assert.match(commands[1] || '', /gsettings set org\.gnome\.desktop\.background picture-uri/)
})

test('ensureOrgoDesktopWallpaper uploads the bundled asset when missing', async () => {
  const commands: string[] = []
  let probeCount = 0

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    if (command === ORGO_WALLPAPER_PROBE_COMMAND) {
      probeCount += 1

      return probeCount === 1
        ? json({ success: false, exit_code: 1, output: 'missing' })
        : json({ success: true, exit_code: 0, output: 'verified' })
    }

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  const result = await ensureOrgoDesktopWallpaper(
    'orgo-secret',
    COMPUTER_ID,
    () => Buffer.from('wallpaper-bytes'),
    fetchImpl
  )

  assert.equal(result.installedNow, true)
  assert.equal(result.applied, true)
  assert.equal(commands.length, 6)
  assert.match(commands[1] || '', new RegExp(ORGO_WALLPAPER_STAGING_PATH))
  assert.match(commands[2] || '', /d2FsbHBhcGVyLWJ5dGVz/)
  assert.match(commands[3] || '', /\| base64 -d \| python3/)
  assert.match(commands[4] || '', /xfconf-query/)
  assert.equal(commands[5], ORGO_WALLPAPER_PROBE_COMMAND)
})

test('ensureOrgoDesktopWallpaper removes staging data when a chunk fails', async () => {
  const commands: string[] = []

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = String((JSON.parse(String(init?.body || '{}')) as { command?: string }).command || '')
    commands.push(command)

    if (command === ORGO_WALLPAPER_PROBE_COMMAND) {
      return json({ success: false, exit_code: 1, output: 'missing' })
    }

    if (command.startsWith('printf %s') && command.includes(`>> ${ORGO_WALLPAPER_STAGING_PATH}`)) {
      return json({ success: false, exit_code: 1, output: 'write failed' })
    }

    return json({ success: true, exit_code: 0, output: '' })
  }) as typeof fetch

  await assert.rejects(
    ensureOrgoDesktopWallpaper('orgo-secret', COMPUTER_ID, () => Buffer.from('wallpaper-bytes'), fetchImpl),
    /write failed/
  )
  assert.match(commands.at(-1) || '', new RegExp(`rm -f ${ORGO_WALLPAPER_STAGING_PATH}`))
})
