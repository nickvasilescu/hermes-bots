import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  launchSshOnlyPackagedApp,
  resolveSshOnlyArtifacts,
  runBundleVerifier,
  sha256File,
  SSH_ONLY_PACKAGED_GATE,
  type SshOnlyPackagedApp,
  writeSshOnlyEvidence
} from './ssh-only-packaged-fixtures'

test.describe('packaged Korgo SSH-only build contract', () => {
  test.skip(!SSH_ONLY_PACKAGED_GATE, 'Set KORGO_SSH_ONLY_PACKAGED_E2E=1 after producing both Linux artifacts')

  test('the unpacked application and AppImage pass the artifact verifier', () => {
    const artifacts = resolveSshOnlyArtifacts()
    const unpacked = runBundleVerifier(artifacts.unpacked)
    const appImage = runBundleVerifier(artifacts.appImage)

    expect(unpacked.status, unpacked.output).toBe(0)
    expect(appImage.status, appImage.output).toBe(0)

    const evidence = writeSshOnlyEvidence('packaged-build-contract', {
      appImage: {
        name: path.basename(artifacts.appImage),
        sha256: sha256File(artifacts.appImage),
        verifierPassed: appImage.status === 0
      },
      unpacked: {
        binaryName: path.basename(artifacts.binary),
        binarySha256: sha256File(artifacts.binary),
        verifierPassed: unpacked.status === 0
      }
    })

    expect(fs.statSync(evidence).mode & 0o077).toBe(0)
  })

  test('the launched artifact keeps Electron pinned and Chromium sandboxed', async () => {
    let fixture: SshOnlyPackagedApp | null = null

    try {
      fixture = await launchSshOnlyPackagedApp('success')

      const runtime = await fixture.app.evaluate(({ BrowserWindow, app }) => {
        const window = BrowserWindow.getAllWindows()[0]

        const preferences = (
          window?.webContents as unknown as {
            getLastWebPreferences: () => {
              contextIsolation?: boolean
              nodeIntegration?: boolean
              sandbox?: boolean
              webviewTag?: boolean
            }
          }
        )?.getLastWebPreferences()

        return {
          appName: app.getName(),
          argv: [...process.argv],
          electronVersion: process.versions.electron,
          preferences: {
            contextIsolation: preferences?.contextIsolation,
            nodeIntegration: preferences?.nodeIntegration,
            sandbox: preferences?.sandbox,
            webviewTag: preferences?.webviewTag
          },
          switches: app.commandLine.getSwitchValue('remote-debugging-port')
        }
      })

      expect(runtime.appName).toBe('Korgo Bot')
      expect(runtime.electronVersion).toBe('43.4.1')
      expect(runtime.preferences).toMatchObject({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      })
      expect(runtime.preferences.webviewTag).not.toBe(true)
      expect(runtime.argv).not.toContain('--no-sandbox')
      const remoteDebuggingArguments = runtime.argv.filter(arg => arg.startsWith('--remote-debugging-port'))
      expect(remoteDebuggingArguments.every(arg => arg === '--remote-debugging-port=0')).toBe(true)
      // Playwright injects --remote-debugging-port=0 before Electron starts.
      // Depending on the Playwright/Electron pairing, that harness argument can
      // remain in process.argv. The bundle verifier above is the product-CDP
      // assertion; this check rejects any nonzero/product-configured port.
      expect(['', '0']).toContain(runtime.switches)
      expect(fs.existsSync(path.join(fixture.sandbox.userDataDir, 'windows-sandbox-fallback.json'))).toBe(false)

      writeSshOnlyEvidence('packaged-runtime-contract', {
        appName: runtime.appName,
        electronVersion: runtime.electronVersion,
        noNoSandboxArgument: !runtime.argv.includes('--no-sandbox'),
        preferences: runtime.preferences,
        productConfiguredCdpArgumentAbsent: remoteDebuggingArguments.every(arg => arg === '--remote-debugging-port=0'),
        playwrightInspectionArgumentObserved: remoteDebuggingArguments.includes('--remote-debugging-port=0'),
        playwrightInspectionPortInjected: runtime.switches === '0',
        sandboxFallbackMarkerAbsent: true
      })
    } finally {
      await fixture?.cleanup()
    }
  })
})
