import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const RELEASE_ROOT = path.join(DESKTOP_ROOT, 'release')
const EVIDENCE_ROOT = path.join(DESKTOP_ROOT, 'test-results', 'ssh-only-evidence')

export const SSH_ONLY_PACKAGED_GATE = process.env.KORGO_SSH_ONLY_PACKAGED_E2E === '1'
export const SSH_ONLY_BINARY_PATH = path.join(RELEASE_ROOT, 'linux-unpacked', 'Korgo Bot')
export const SSH_ONLY_IDENTITY_PATH = '/run/korgo-ssh/identity'
export const SSH_ONLY_KNOWN_HOSTS_PATH = '/run/korgo-ssh/known_hosts'
export const SSH_ONLY_DUMMY_MARKER_PATH = '/run/korgo-ssh/e2e-dummy-inputs'
export const SSH_ONLY_DUMMY_MARKER = 'KORGO_SSH_ONLY_E2E_DUMMY_INPUTS_V1'
export const SSH_ONLY_TEST_HOST = '100.100.10.20'

export type FakeSshScenario = 'success' | 'host-key-changed' | 'host-key-unknown' | 'unreachable'

export interface SshOnlyArtifacts {
  appImage: string
  binary: string
  unpacked: string
}

export interface FakeSshObservation {
  atMs: number
  operation: string
  options: {
    globalKnownHostsFile: string | null
    identitiesOnly: string | null
    identityFile: string | null
    identityAgent: string | null
    strictHostKeyChecking: string | null
    updateHostKeys: string | null
    userKnownHostsFile: string | null
  }
  scenario: FakeSshScenario
}

export interface SshOnlySandbox {
  fakeSshLog: string
  hermesHome: string
  home: string
  root: string
  userDataDir: string
  cleanup: () => void
}

export interface SshOnlyPackagedApp {
  app: ElectronApplication
  page: Page
  sandbox: SshOnlySandbox
  cleanup: () => Promise<void>
}

const CREDENTIAL_NAME = /(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_ACCESS_KEY|_PRIVATE_KEY|_OAUTH_TOKEN)$/
const EXPLICIT_CREDENTIAL_NAMES = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CUSTOM_API_KEY',
  'GEMINI_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENROUTER_BASE_URL'
])

function cleanEnvironment(): Record<string, string> {
  const clean: Record<string, string> = {}

  for (const [name, value] of Object.entries(process.env)) {
    if (!value || CREDENTIAL_NAME.test(name) || EXPLICIT_CREDENTIAL_NAMES.has(name)) continue
    if (name === 'SSH_AUTH_SOCK' || name === 'SSH_AGENT_PID' || name === 'GPG_AGENT_INFO') continue
    if (name.startsWith('HERMES_DESKTOP_') || name.startsWith('VITE_HERMES_DESKTOP_')) continue
    clean[name] = value
  }

  return clean
}

export function resolveSshOnlyArtifacts(): SshOnlyArtifacts {
  const appImages = fs.existsSync(RELEASE_ROOT)
    ? fs
        .readdirSync(RELEASE_ROOT)
        .filter(name => /^Korgo-Bot-.+-linux-.+\.AppImage$/.test(name))
        .map(name => path.join(RELEASE_ROOT, name))
    : []

  if (!fs.existsSync(SSH_ONLY_BINARY_PATH)) {
    throw new Error(`Packaged SSH-only binary is missing: ${SSH_ONLY_BINARY_PATH}`)
  }

  if (appImages.length !== 1) {
    throw new Error(`Expected exactly one packaged SSH-only AppImage, found ${appImages.length} under ${RELEASE_ROOT}`)
  }

  return {
    appImage: appImages[0],
    binary: SSH_ONLY_BINARY_PATH,
    unpacked: path.dirname(SSH_ONLY_BINARY_PATH)
  }
}

function fakeSshProgram(): string {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const logPath = process.env.KORGO_FAKE_SSH_LOG
const scenario = process.env.KORGO_FAKE_SSH_SCENARIO || 'success'
const statePath = logPath + '.master'
const joined = args.join(' ')
const option = name => {
  const prefix = name + '='
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === '-o' && String(args[i + 1]).startsWith(prefix)) return String(args[i + 1]).slice(prefix.length)
  }
  return null
}
const control = (() => {
  const index = args.indexOf('-O')
  return index >= 0 ? args[index + 1] : ''
})()
let operation = 'command'
if (args.includes('-G')) operation = 'config-probe'
else if (control === 'check') operation = 'control-check'
else if (control === 'forward') operation = 'forward'
else if (control === 'cancel') operation = 'cancel-forward'
else if (control === 'exit') operation = 'control-exit'
else if (args.some(arg => String(arg).includes('ControlMaster=yes'))) operation = 'control-master'
else if (joined.includes('sys.stdin.buffer.read')) operation = 'token-upload'
else if (joined.includes('nohup') && joined.includes('ssh-owner-nonce')) operation = 'remote-start'
else if (joined.includes('uname -s; uname -m')) operation = 'platform-probe'
else if (joined.includes('--version')) operation = 'version-probe'
else if (joined.includes('serve --help')) operation = 'capability-probe'
else if (joined.includes('HERMES_HOME')) operation = 'home-probe'
else if (joined.includes('kill -0')) operation = 'liveness-probe'
else if (joined.includes('cat ') && joined.includes('.log')) operation = 'ready-probe'
else if (joined.includes('cat ') && joined.includes('.json')) operation = 'lock-read'
else if (joined.includes('[ -x ')) operation = 'executable-probe'
else if (joined.includes('exit 0')) operation = 'connection-probe'
fs.appendFileSync(logPath, JSON.stringify({
  atMs: Date.now(),
  operation,
  options: {
    globalKnownHostsFile: option('GlobalKnownHostsFile'),
    identitiesOnly: option('IdentitiesOnly'),
    identityFile: (() => { const i = args.indexOf('-i'); return i >= 0 ? args[i + 1] : null })(),
    identityAgent: option('IdentityAgent'),
    strictHostKeyChecking: option('StrictHostKeyChecking'),
    updateHostKeys: option('UpdateHostKeys'),
    userKnownHostsFile: option('UserKnownHostsFile')
  },
  scenario
}) + '\\n', { mode: 0o600 })
if (scenario === 'host-key-changed') {
  process.stderr.write('WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\\n')
  process.exit(255)
}
if (scenario === 'host-key-unknown') {
  process.stderr.write('Host key verification failed.\\n')
  process.exit(255)
}
if (scenario === 'unreachable') {
  process.stderr.write('ssh: connect to host 100.100.10.20 port 22: Network is unreachable\\n')
  process.exit(255)
}
if (operation === 'control-check' && !fs.existsSync(statePath)) process.exit(255)
if (operation === 'control-master') fs.writeFileSync(statePath, 'dummy-master\\n', { mode: 0o600 })
if (operation === 'config-probe') process.stdout.write('hostname 100.100.10.20\\nuser korgo-e2e\\nport 22\\n')
else if (operation === 'platform-probe') process.stdout.write('Linux\\nx86_64\\n')
else if (operation === 'version-probe') process.stdout.write('Hermes Agent v0.20.4\\n')
else if (operation === 'capability-probe') process.stdout.write('YES\\n')
else if (operation === 'home-probe') process.stdout.write('/tmp/korgo-e2e-hermes\\n')
else if (operation === 'executable-probe') process.stdout.write('OK\\n')
else if (operation === 'liveness-probe') process.stdout.write('ALIVE\\n')
else if (operation === 'ready-probe') process.stdout.write('HERMES_DASHBOARD_READY port=51999\\n')
else if (operation === 'remote-start') process.stdout.write('777\\n')
if (operation === 'forward') setInterval(() => {}, 60_000)
`
}

export function createSshOnlySandbox(scenario: FakeSshScenario): SshOnlySandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korgo-ssh-only-e2e-'))
  const home = path.join(root, 'home')
  const hermesHome = path.join(root, 'hermes-home')
  const userDataDir = path.join(root, 'user-data')
  const runtimeDir = path.join(root, 'runtime')
  const fakeBin = path.join(root, 'fake-bin')
  const fakeSshLog = path.join(root, 'fake-ssh.jsonl')

  for (const dir of [home, hermesHome, userDataDir, runtimeDir, fakeBin]) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  }

  const fakeSsh = path.join(fakeBin, 'ssh')
  fs.writeFileSync(fakeSsh, fakeSshProgram(), { mode: 0o700 })
  fs.writeFileSync(fakeSshLog, '', { mode: 0o600 })
  fs.writeFileSync(path.join(root, 'scenario'), `${scenario}\n`, { mode: 0o600 })

  return {
    fakeSshLog,
    hermesHome,
    home,
    root,
    userDataDir,
    cleanup: () => fs.rmSync(root, { force: true, recursive: true })
  }
}

export function assertDummyPinnedInputs(host = SSH_ONLY_TEST_HOST): void {
  const marker = fs.readFileSync(SSH_ONLY_DUMMY_MARKER_PATH, 'utf8').trim()

  if (marker !== SSH_ONLY_DUMMY_MARKER) {
    throw new Error(`Refusing to exercise SSH: ${SSH_ONLY_DUMMY_MARKER_PATH} does not declare dummy inputs`)
  }

  for (const filePath of [SSH_ONLY_IDENTITY_PATH, SSH_ONLY_KNOWN_HOSTS_PATH]) {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0) {
      throw new Error(`Refusing unsafe SSH-only E2E input: ${filePath}`)
    }
  }

  const hosts = fs.readFileSync(SSH_ONLY_KNOWN_HOSTS_PATH, 'utf8')
  const hasExactHost = hosts
    .split(/\r?\n/)
    .some(line => line.trim() && !line.trim().startsWith('#') && line.trim().split(/\s+/, 1)[0].split(',').includes(host))

  if (!hasExactHost) throw new Error(`Dummy known_hosts does not contain the exact E2E host ${host}`)
}

export function writeSshConnectionConfig(
  sandbox: SshOnlySandbox,
  overrides: Partial<{ host: string; profile: string; remotePath: string; token: string; user: string }> = {}
): string {
  const configPath = path.join(sandbox.userDataDir, 'connection.json')
  const remote = {
    host: overrides.host ?? SSH_ONLY_TEST_HOST,
    keyPath: SSH_ONLY_IDENTITY_PATH,
    mode: 'ssh',
    port: 22,
    remoteHermesPath: overrides.remotePath ?? '/opt/hermes/bin/hermes',
    remoteProfile: overrides.profile ?? 'korgo_e2e',
    ...(overrides.token ? { token: overrides.token } : {}),
    user: overrides.user ?? 'korgo-e2e'
  }
  fs.writeFileSync(configPath, JSON.stringify({ mode: 'ssh', profiles: {}, remote }, null, 2), { mode: 0o600 })

  return configPath
}

export async function launchSshOnlyPackagedApp(
  scenario: FakeSshScenario,
  options: {
    connectionOverrides?: Partial<{ host: string; profile: string; remotePath: string; token: string; user: string }>
    requirePinnedInputs?: boolean
    writeConfig?: boolean
  } = {}
): Promise<SshOnlyPackagedApp> {
  if (process.platform !== 'linux') throw new Error('The packaged SSH-only security suite is Linux-only')
  const artifacts = resolveSshOnlyArtifacts()
  if (options.requirePinnedInputs) assertDummyPinnedInputs()

  const sandbox = createSshOnlySandbox(scenario)
  if (options.writeConfig) writeSshConnectionConfig(sandbox, options.connectionOverrides)
  const fakeBin = path.join(sandbox.root, 'fake-bin')
  const env = {
    ...cleanEnvironment(),
    HOME: sandbox.home,
    HERMES_HOME: sandbox.hermesHome,
    HERMES_DESKTOP_USER_DATA_DIR: sandbox.userDataDir,
    KORGO_FAKE_SSH_LOG: sandbox.fakeSshLog,
    KORGO_FAKE_SSH_SCENARIO: scenario,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || '/usr/bin:/bin'}`,
    XDG_CACHE_HOME: path.join(sandbox.home, '.cache'),
    XDG_CONFIG_HOME: path.join(sandbox.home, '.config'),
    XDG_DATA_HOME: path.join(sandbox.home, '.local', 'share'),
    XDG_RUNTIME_DIR: path.join(sandbox.root, 'runtime')
  }

  const app = await _electron.launch({
    args: ['--disable-gpu'],
    env,
    executablePath: artifacts.binary
  })
  const page = await app.firstWindow()

  return {
    app,
    page,
    sandbox,
    cleanup: async () => {
      await app.close().catch(() => undefined)
      sandbox.cleanup()
    }
  }
}

export function readFakeSshObservations(sandbox: SshOnlySandbox): FakeSshObservation[] {
  return fs
    .readFileSync(sandbox.fakeSshLog, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as FakeSshObservation)
}

export async function waitForFakeSshOperation(
  sandbox: SshOnlySandbox,
  operation: string,
  timeoutMs = 30_000
): Promise<FakeSshObservation> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = readFakeSshObservations(sandbox).find(item => item.operation === operation)
    if (found) return found
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  throw new Error(`Timed out waiting for fake SSH operation ${operation}`)
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)

  try {
    let read = 0
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read))
  } finally {
    fs.closeSync(fd)
  }

  return hash.digest('hex')
}

function assertRedacted(value: unknown): void {
  const serialized = JSON.stringify(value)
  const forbidden = [
    /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/i,
    /[?&](?:token|ticket)=/i,
    /authorization\s*[:=]\s*bearer/i,
    /KORGO_E2E_SENTINEL_CREDENTIAL/
  ]

  for (const pattern of forbidden) {
    if (pattern.test(serialized)) throw new Error(`Refusing to emit evidence matching ${pattern}`)
  }
}

export function writeSshOnlyEvidence(name: string, observations: Record<string, unknown>): string {
  const evidence = {
    generatedAt: new Date().toISOString(),
    observations,
    reviewedGitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: DESKTOP_ROOT, encoding: 'utf8' }).trim(),
    schemaVersion: 1
  }
  assertRedacted(evidence)
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true })
  const destination = path.join(EVIDENCE_ROOT, `${name}.json`)
  fs.writeFileSync(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })

  return destination
}

export function runBundleVerifier(artifactPath: string): { output: string; status: number | null } {
  const result = spawnSync(process.execPath, [path.join(DESKTOP_ROOT, 'scripts', 'verify-ssh-only-bundle.mjs'), artifactPath], {
    cwd: DESKTOP_ROOT,
    encoding: 'utf8'
  })

  return { output: `${result.stdout || ''}${result.stderr || ''}`.trim(), status: result.status }
}
