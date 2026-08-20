import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import path from 'node:path'

import type { App } from 'electron'

import { sandboxFallbackFromEnv } from './updater-process'
import {
  alreadyHasNoSandbox,
  buildNoSandboxRelaunchArgs,
  decideWindowsSandboxLaunch,
  fallbackMarker,
  grantAllApplicationPackagesAcl,
  markerAfterSuccessfulBoot,
  readSandboxMarker,
  type SandboxFallbackReason,
  shouldAttemptAclRepair,
  shouldRelaunchForGpuSandboxCrash,
  shouldRelaunchForRendererSandboxCrashLoop,
  writeSandboxMarker
} from './windows-sandbox-fallback'

type ExecFileSync = (
  file: string,
  args?: readonly string[],
  options?: ExecFileSyncOptionsWithStringEncoding
) => string | Buffer

let active = false
let sticky = false
let reason: SandboxFallbackReason = 'boot-loop'
let relaunchAttempted = false
let desktopApp: App | null = null

function initialize(app: App, execFileSync: ExecFileSync): void {
  desktopApp = app

  if (process.platform !== 'win32') {return}

  const userData = app.getPath('userData')
  const priorMarker = readSandboxMarker(userData)

  if (shouldAttemptAclRepair(priorMarker)) {
    const exeDir = path.dirname(process.execPath)
    const acl = grantAllApplicationPackagesAcl(exeDir, { execFileSync })

    if (acl.ok) {console.log(`[hermes] granted ALL APPLICATION PACKAGES RX on ${exeDir} (#38216)`)}
    else if (acl.error && acl.error !== 'missing-target-or-exec') {
      console.warn(`[hermes] AppContainer ACL grant failed on ${exeDir}: ${acl.error}`)
    }
  }

  const decision = decideWindowsSandboxLaunch({
    argv: process.argv,
    env: process.env,
    marker: priorMarker,
    appVersion: app.getVersion()
  })

  active = decision.enable
  sticky = decision.nextMarker.state === 'fallback'

  if (decision.nextMarker.state === 'fallback' && decision.nextMarker.reason) {reason = decision.nextMarker.reason}

  if (decision.enable && decision.reason !== 'already-enabled') {
    app.commandLine.appendSwitch('no-sandbox')
    process.env.ELECTRON_DISABLE_SANDBOX = '1'
    console.log(`[hermes] Windows sandbox fallback enabled (${decision.reason}); launching without Chromium sandbox`)
  }

  writeSandboxMarker(userData, decision.nextMarker)

  app.on('child-process-gone', (_event, details) => {
    if (
      !shouldRelaunchForGpuSandboxCrash({
        details,
        alreadyNoSandbox: active || alreadyHasNoSandbox(process.argv, process.env),
        relaunchAttempted
      })
    ) {
      return
    }

    relaunchAttempted = true
    active = true
    sticky = true
    reason = 'gpu-breakpoint'

    try {
      writeSandboxMarker(app.getPath('userData'), fallbackMarker(reason, app.getVersion()))
    } catch {
      // Best-effort crash recovery marker.
    }

    console.warn(`[hermes] Windows GPU sandbox crashed (exit=${details?.exitCode}); relaunching once`)

    try {
      app.relaunch({ args: buildNoSandboxRelaunchArgs(process.argv.slice(1)) })
      app.exit(0)
    } catch (error) {
      console.error(`[hermes] sandbox fallback relaunch failed: ${error instanceof Error ? error.message : error}`)
    }
  })
}

function appendUpdaterFallback(args: string[], relaunchArgs: string[]): void {
  if (sandboxFallbackFromEnv(process.env, relaunchArgs)) {args.push('--sandbox-fallback')}
}

function markWindowRevealed(log: (message: string) => void): void {
  if (process.platform !== 'win32' || !desktopApp) {return}

  try {
    writeSandboxMarker(
      desktopApp.getPath('userData'),
      markerAfterSuccessfulBoot({
        fallbackActive: sticky,
        reason,
        appVersion: desktopApp.getVersion()
      })
    )
  } catch (error) {
    log(`[sandbox] marker update after main-window reveal failed: ${error instanceof Error ? error.message : error}`)
  }
}

function handleRendererCrashLoop(details: any, log: (message: string) => void): void {
  if (!desktopApp) {return}

  if (
    !shouldRelaunchForRendererSandboxCrashLoop({
      reason: details?.reason,
      exitCode: details?.exitCode,
      alreadyNoSandbox: active || alreadyHasNoSandbox(process.argv, process.env),
      relaunchAttempted
    })
  ) {
    return
  }

  relaunchAttempted = true
  active = true
  sticky = true
  reason = 'renderer-crash-loop'

  try {
    writeSandboxMarker(desktopApp.getPath('userData'), fallbackMarker(reason, desktopApp.getVersion()))
  } catch {
    // Best-effort crash recovery marker.
  }

  log('[renderer] Windows sandbox crash loop detected; relaunching once')

  try {
    desktopApp.relaunch({ args: buildNoSandboxRelaunchArgs(process.argv.slice(1)) })
    desktopApp.exit(0)
  } catch (error) {
    log(`[renderer] sandbox fallback relaunch failed: ${error instanceof Error ? error.message : error}`)
  }
}

function markCleanQuit(): void {
  if (process.platform !== 'win32' || sticky || !desktopApp) {return}

  try {
    writeSandboxMarker(desktopApp.getPath('userData'), markerAfterSuccessfulBoot({ fallbackActive: false }))
  } catch {
    // A clean-quit marker is best effort.
  }
}

export const windowsSandboxIntegration = {
  appendUpdaterFallback,
  handleRendererCrashLoop,
  initialize,
  markCleanQuit,
  markWindowRevealed
}
