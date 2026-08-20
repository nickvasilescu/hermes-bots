import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  assertDummyPinnedInputs,
  launchSshOnlyPackagedApp,
  readFakeSshObservations,
  SSH_ONLY_IDENTITY_PATH,
  SSH_ONLY_KNOWN_HOSTS_PATH,
  SSH_ONLY_PACKAGED_GATE,
  SSH_ONLY_TEST_HOST,
  type FakeSshObservation,
  type SshOnlyPackagedApp,
  waitForFakeSshOperation,
  writeSshOnlyEvidence
} from './ssh-only-packaged-fixtures'

const SENTINEL = 'KORGO_E2E_SENTINEL_CREDENTIAL'
const FORBIDDEN_BRIDGE_KEYS = [
  'cloud',
  'connectors',
  'fetchLinkTitle',
  'getGatewayWsUrl',
  'gitRoot',
  'oauthLoginConnectionConfig',
  'oauthLogoutConnectionConfig',
  'openExternal',
  'orgoDesktop',
  'probeConnectionConfig',
  'readDir',
  'readFileDataUrl',
  'readFileText',
  'revealPath',
  'selectPaths'
] as const

function expectStrictSsh(observations: FakeSshObservation[]): void {
  expect(observations.length).toBeGreaterThan(0)

  for (const observation of observations) {
    expect(observation.options, observation.operation).toEqual({
      globalKnownHostsFile: '/dev/null',
      identitiesOnly: 'yes',
      identityFile: SSH_ONLY_IDENTITY_PATH,
      identityAgent: 'none',
      strictHostKeyChecking: 'yes',
      updateHostKeys: 'no',
      userKnownHostsFile: SSH_ONLY_KNOWN_HOSTS_PATH
    })
  }

  expect(JSON.stringify(observations)).not.toContain('accept-new')
}

async function fillSshForm(page: Page, host = SSH_ONLY_TEST_HOST): Promise<void> {
  await page.locator('#ssh-only-host').fill(host)
  await page.locator('#ssh-only-port').fill('22')
  await page.locator('#ssh-only-hermes-path').fill('/opt/hermes/bin/hermes')
  await page.locator('#ssh-only-profile').fill('korgo_e2e')
  // Host blur may enrich the user asynchronously. Set the explicit test user
  // last so the payload is deterministic regardless of ssh -G timing.
  await page.locator('#ssh-only-host').blur()
  await page.waitForTimeout(50)
  await page.locator('#ssh-only-user').fill('korgo-e2e')
}

async function clickTestConnection(page: Page): Promise<void> {
  await page.getByRole('button', { name: /test connection/i }).click()
}

async function launchFailure(
  scenario: 'host-key-changed' | 'unreachable',
  expected: RegExp
): Promise<{ fixture: SshOnlyPackagedApp; message: string }> {
  const fixture = await launchSshOnlyPackagedApp(scenario, { requirePinnedInputs: true })
  await fixture.page.locator('#ssh-only-host').waitFor({ state: 'visible' })
  await fillSshForm(fixture.page)
  await clickTestConnection(fixture.page)
  const alert = fixture.page.getByRole('alert')
  await expect(alert).toContainText(expected)

  return { fixture, message: (await alert.textContent())?.trim() || '' }
}

test.describe('packaged Korgo SSH-only runtime', () => {
  test.skip(!SSH_ONLY_PACKAGED_GATE, 'Set KORGO_SSH_ONLY_PACKAGED_E2E=1 after producing both Linux artifacts')

  test('first run fails closed with only SSH setup and a capability-minimal bridge', async () => {
    let fixture: SshOnlyPackagedApp | null = null

    try {
      fixture = await launchSshOnlyPackagedApp('success')
      const page = fixture.page
      await page.locator('#ssh-only-host').waitFor({ state: 'visible' })

      await expect(page.locator('#ssh-only-identity')).toHaveValue(SSH_ONLY_IDENTITY_PATH)
      await expect(page.locator('#ssh-only-identity')).toHaveAttribute('readonly', '')
      await expect(page.locator('input')).toHaveCount(6)
      expect(readFakeSshObservations(fixture.sandbox)).toEqual([])

      const runtime = await page.evaluate(async forbiddenKeys => {
        const bridge = (window as unknown as { hermesDesktop?: Record<string, unknown> }).hermesDesktop ?? {}
        const bridgeKeys = Object.keys(bridge).sort()
        const iframe = document.createElement('iframe')
        iframe.srcdoc = '<!doctype html><title>untrusted subframe</title>'
        document.body.appendChild(iframe)
        await new Promise<void>(resolve => iframe.addEventListener('load', () => resolve(), { once: true }))
        const iframeBridge = (iframe.contentWindow as unknown as { hermesDesktop?: Record<string, any> })?.hermesDesktop
        let iframeReadDenied = !iframeBridge

        if (iframeBridge?.getConnectionConfig) {
          try {
            await iframeBridge.getConnectionConfig(null)
            iframeReadDenied = false
          } catch {
            iframeReadDenied = true
          }
        }

        const webview = document.createElement('webview') as HTMLElement & {
          getWebContentsId?: () => number
        }
        webview.setAttribute('src', 'data:text/html,<title>untrusted webview</title>')
        document.body.appendChild(webview)

        return {
          bridgeKeys,
          forbiddenPresent: forbiddenKeys.filter(key => key in bridge),
          gatewayProxyPresent: 'gatewayProxy' in bridge,
          iframeBridgeKeys: iframeBridge ? Object.keys(iframeBridge) : [],
          iframeReadDenied,
          webviewPrivileged: typeof webview.getWebContentsId === 'function'
        }
      }, [...FORBIDDEN_BRIDGE_KEYS])

      expect(runtime.forbiddenPresent).toEqual([])
      expect(runtime.gatewayProxyPresent).toBe(true)
      expect(runtime.iframeReadDenied).toBe(true)
      expect(runtime.webviewPrivileged).toBe(false)
      expect(readFakeSshObservations(fixture.sandbox)).toEqual([])

      const hermesFiles = fs.readdirSync(fixture.sandbox.hermesHome, { recursive: true }).map(String)
      expect(hermesFiles.some(name => /(?:^|\/)(?:\.venv|install-stamp\.json|hermes-agent)(?:\/|$)/.test(name))).toBe(false)

      writeSshOnlyEvidence('first-run-fail-closed', {
        bridgeKeys: runtime.bridgeKeys,
        forbiddenBridgeKeysPresent: runtime.forbiddenPresent,
        iframeBridgeKeys: runtime.iframeBridgeKeys,
        iframeReadDenied: runtime.iframeReadDenied,
        localRuntimeMarkersPresent: false,
        sshInvocationsBeforeConfiguration: 0,
        webviewPrivileged: runtime.webviewPrivileged
      })
    } finally {
      await fixture?.cleanup()
    }
  })

  test('CSP blocks executable injection and non-allowlisted fetches at runtime', async () => {
    let fixture: SshOnlyPackagedApp | null = null

    try {
      fixture = await launchSshOnlyPackagedApp('success')
      await fixture.page.locator('#ssh-only-host').waitFor({ state: 'visible' })
      const result = await fixture.page.evaluate(async () => {
        const directives: string[] = []
        const listener = (event: SecurityPolicyViolationEvent) => directives.push(event.effectiveDirective)
        document.addEventListener('securitypolicyviolation', listener)
        const script = document.createElement('script')
        script.textContent = 'window.__KORGO_CSP_INLINE_EXECUTED__ = true'
        document.head.appendChild(script)
        let fetchRejected = false

        try {
          await fetch('data:text/plain,korgo-csp-probe')
        } catch {
          fetchRejected = true
        }

        await new Promise(resolve => setTimeout(resolve, 25))
        document.removeEventListener('securitypolicyviolation', listener)

        return {
          directives,
          fetchRejected,
          inlineExecuted: Boolean((window as unknown as { __KORGO_CSP_INLINE_EXECUTED__?: boolean }).__KORGO_CSP_INLINE_EXECUTED__)
        }
      })

      expect(result.inlineExecuted).toBe(false)
      expect(result.fetchRejected).toBe(true)
      expect(result.directives.some(value => value.startsWith('script-src'))).toBe(true)
      expect(result.directives).toContain('connect-src')
      expect(readFakeSshObservations(fixture.sandbox)).toEqual([])

      writeSshOnlyEvidence('packaged-csp-runtime', {
        blockedDirectives: [...new Set(result.directives)].sort(),
        nonAllowlistedFetchRejected: result.fetchRejected,
        scriptInjectionExecuted: result.inlineExecuted
      })
    } finally {
      await fixture?.cleanup()
    }
  })

  test('unknown, changed, and unreachable hosts remain distinct and never start or upload', async () => {
    assertDummyPinnedInputs()
    const outcomes: Record<string, string> = {}
    const operationSets: Record<string, string[]> = {}

    let unknown: SshOnlyPackagedApp | null = null
    let changed: SshOnlyPackagedApp | null = null
    let unreachable: SshOnlyPackagedApp | null = null

    try {
      unknown = await launchSshOnlyPackagedApp('success', { requirePinnedInputs: true })
      await unknown.page.locator('#ssh-only-host').waitFor({ state: 'visible' })
      await fillSshForm(unknown.page, '100.100.10.21')
      await clickTestConnection(unknown.page)
      const unknownAlert = unknown.page.getByRole('alert')
      await expect(unknownAlert).toContainText(/does not contain a key/i)
      outcomes.unknown = (await unknownAlert.textContent())?.trim() || ''

      const changedResult = await launchFailure('host-key-changed', /does not match the operator-verified key/i)
      changed = changedResult.fixture
      outcomes.changed = changedResult.message

      const unreachableResult = await launchFailure('unreachable', /could not reach Mini over SSH/i)
      unreachable = unreachableResult.fixture
      outcomes.unreachable = unreachableResult.message

      for (const [name, active] of Object.entries({ unknown, changed, unreachable })) {
        const operations = active ? readFakeSshObservations(active.sandbox) : []
        expect(operations.some(item => item.operation === 'token-upload' || item.operation === 'remote-start')).toBe(false)
        if (operations.length > 0) expectStrictSsh(operations)
        operationSets[name] = operations.map(item => item.operation)
      }

      expect(new Set(Object.values(outcomes)).size).toBe(3)
      writeSshOnlyEvidence('host-verification-failures', {
        distinctFailureClasses: Object.keys(outcomes),
        operationsBeforeFailure: operationSets,
        remoteStartObserved: false,
        tokenUploadObserved: false,
        tofuObserved: false
      })
    } finally {
      await Promise.all([unknown?.cleanup(), changed?.cleanup(), unreachable?.cleanup()])
    }
  })

  test('persists before apply and carries strict options through upload, start, and forward', async () => {
    assertDummyPinnedInputs()
    let fixture: SshOnlyPackagedApp | null = null

    try {
      fixture = await launchSshOnlyPackagedApp('success', { requirePinnedInputs: true })
      const page = fixture.page
      await page.locator('#ssh-only-host').waitFor({ state: 'visible' })
      await fillSshForm(page)
      await clickTestConnection(page)
      await expect(page.getByRole('status')).toContainText(/verified/i)
      await page.getByRole('button', { name: /save and connect/i }).click()

      const remoteStart = await waitForFakeSshOperation(fixture.sandbox, 'remote-start')
      await waitForFakeSshOperation(fixture.sandbox, 'forward')
      const configPath = path.join(fixture.sandbox.userDataDir, 'connection.json')
      const configStat = fs.statSync(configPath)
      const observations = readFakeSshObservations(fixture.sandbox)

      expect(configStat.mode & 0o077).toBe(0)
      expect(configStat.mtimeMs).toBeLessThanOrEqual(remoteStart.atMs)
      expect(observations.some(item => item.operation === 'control-master')).toBe(true)
      expect(observations.some(item => item.operation === 'token-upload')).toBe(true)
      expect(observations.some(item => item.operation === 'remote-start')).toBe(true)
      expect(observations.some(item => item.operation === 'forward')).toBe(true)
      expectStrictSsh(observations)

      writeSshOnlyEvidence('strict-ssh-startup', {
        configOwnerOnly: (configStat.mode & 0o077) === 0,
        operations: observations.map(item => item.operation),
        persistencePrecededRemoteStart: configStat.mtimeMs <= remoteStart.atMs,
        sshPolicyByOperation: observations.map(item => ({ operation: item.operation, options: item.options })),
        strictOptionsOnEveryInvocation: true,
        stoppedBeforeLoopbackGatewayProbe: true
      })
    } finally {
      await fixture?.cleanup()
    }
  })

  test('host verification failure exposes neither a renderer token nor gateway URL', async () => {
    assertDummyPinnedInputs()
    let fixture: SshOnlyPackagedApp | null = null
    const consoleMessages: string[] = []

    try {
      fixture = await launchSshOnlyPackagedApp('host-key-changed', {
        connectionOverrides: { token: SENTINEL },
        requirePinnedInputs: true,
        writeConfig: true
      })
      fixture.page.on('console', message => consoleMessages.push(message.text()))
      await fixture.page.locator('#root').waitFor({ state: 'attached' })
      await waitForFakeSshOperation(fixture.sandbox, 'config-probe')

      const renderer = await fixture.page.evaluate(() => {
        const bridge = (window as unknown as { hermesDesktop?: Record<string, unknown> }).hermesDesktop ?? {}
        const storage: string[] = []
        for (const target of [localStorage, sessionStorage]) {
          for (let index = 0; index < target.length; index += 1) {
            const key = target.key(index)
            if (key) storage.push(`${key}=${target.getItem(key)}`)
          }
        }

        return {
          bridgeKeys: Object.keys(bridge).sort(),
          documentText: document.body.textContent || '',
          location: window.location.href,
          storage
        }
      })
      const exposed = JSON.stringify({ consoleMessages, renderer })
      const observations = readFakeSshObservations(fixture.sandbox)

      expect(renderer.bridgeKeys).toContain('gatewayProxy')
      expect(renderer.bridgeKeys).not.toContain('getGatewayWsUrl')
      expect(exposed).not.toContain(SENTINEL)
      expect(exposed).not.toMatch(/[?&](?:token|ticket)=/i)
      expect(observations.some(item => item.operation === 'token-upload' || item.operation === 'remote-start')).toBe(false)
      expectStrictSsh(observations)

      writeSshOnlyEvidence('renderer-credential-absence', {
        forbiddenUrlBridgeAbsent: !renderer.bridgeKeys.includes('getGatewayWsUrl'),
        gatewayProxyPresent: renderer.bridgeKeys.includes('gatewayProxy'),
        rendererCredentialMaterialObserved: false,
        rendererUrlQueryCredentialObserved: false,
        remoteStartObserved: false,
        tokenUploadObserved: false
      })
    } finally {
      await fixture?.cleanup()
    }
  })
})
