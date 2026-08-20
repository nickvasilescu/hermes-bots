import { useMemo, useState } from 'react'

import { isNumericTailscaleIp } from '@/app/settings/ssh-host-selection'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesktopConnectionConfigInput, DesktopConnectionTestResult } from '@/global'
import { useI18n } from '@/i18n'
import { AlertCircle, Check, Loader2 } from '@/lib/icons'

export const SSH_ONLY_IDENTITY_PATH = '/run/korgo-ssh/identity'

const RESERVED_PROFILES = new Set(['hermes', 'test', 'tmp', 'root', 'sudo'])
// eslint-disable-next-line no-control-regex -- SSH form values reject control characters
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

interface FirstRunSshFormProps {
  onBack?: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error')
}

function validateOptionalValue(label: string, value: string): string | null {
  if (CONTROL_CHAR_RE.test(value) || value.startsWith('-')) {
    return `${label} contains an unsafe value.`
  }

  return null
}

export function validateFirstRunSshInput(input: {
  host: string
  user: string
  port: string
  remoteHermesPath: string
  remoteProfile: string
}): string | null {
  if (!isNumericTailscaleIp(input.host)) {
    return 'Enter the Mini numeric Tailscale IP address.'
  }

  if (!input.user) {
    return 'Enter the Mini SSH user.'
  }

  for (const [label, value] of [
    ['SSH user', input.user],
    ['Remote Hermes path', input.remoteHermesPath],
    ['Remote profile', input.remoteProfile]
  ]) {
    const error = validateOptionalValue(label, value)

    if (error) {
      return error
    }
  }

  const port = Number(input.port)

  if (!/^\d+$/.test(input.port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return 'SSH port must be an integer from 1 to 65535.'
  }

  if (
    input.remoteHermesPath &&
    input.remoteHermesPath !== '~' &&
    !input.remoteHermesPath.startsWith('~/') &&
    !input.remoteHermesPath.startsWith('/')
  ) {
    return 'Remote Hermes path must be absolute or start with ~/.'
  }

  if (
    input.remoteProfile &&
    (RESERVED_PROFILES.has(input.remoteProfile) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.remoteProfile))
  ) {
    return 'Remote profile must be a valid Hermes profile name.'
  }

  return null
}

function sshResultError(result: DesktopConnectionTestResult, copy: ReturnType<typeof useI18n>['t']['install']): string {
  switch (result.sshError) {
    case 'host-key-changed':
      return copy.sshOnlyHostKeyChanged

    case 'host-key-unknown':
      return copy.sshOnlyHostKeyUnknown

    case 'known-hosts-missing':
      return copy.sshOnlyKnownHostsMissing

    case 'known-hosts-unsafe':
      return copy.sshOnlyKnownHostsUnsafe

    case 'identity-missing':
      return copy.sshOnlyIdentityMissing

    case 'identity-unsafe':
      return copy.sshOnlyIdentityUnsafe

    case 'auth-failed':
      return copy.sshOnlyAuthFailed

    case 'timeout':
      return copy.sshOnlyTimeout

    case 'unreachable':
      return copy.sshOnlyUnreachable

    default:
      return result.error || copy.sshOnlyTestFailed
  }
}

export function FirstRunSshForm({ onBack }: FirstRunSshFormProps) {
  const { t } = useI18n()
  const copy = t.install
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('22')
  const [remoteHermesPath, setRemoteHermesPath] = useState('')
  const [remoteProfile, setRemoteProfile] = useState('')
  const [testing, setTesting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testedPayloadKey, setTestedPayloadKey] = useState<string | null>(null)

  const payload = useMemo<DesktopConnectionConfigInput>(
    () => ({
      mode: 'ssh',
      profile: null,
      sshHost: host.trim(),
      sshUser: user.trim(),
      sshPort: Number(port),
      sshKeyPath: SSH_ONLY_IDENTITY_PATH,
      sshRemoteHermesPath: remoteHermesPath.trim(),
      sshRemoteProfile: remoteProfile.trim()
    }),
    [host, port, remoteHermesPath, remoteProfile, user]
  )

  const payloadKey = JSON.stringify(payload)

  const validationError = validateFirstRunSshInput({
    host: payload.sshHost || '',
    user: payload.sshUser || '',
    port,
    remoteHermesPath: payload.sshRemoteHermesPath || '',
    remoteProfile: payload.sshRemoteProfile || ''
  })

  const tested = testedPayloadKey === payloadKey

  const invalidate = () => {
    setError(null)
    setSuccess(null)
    setTestedPayloadKey(null)
  }

  const testConnection = async () => {
    if (validationError) {
      setError(validationError)

      return
    }

    setTesting(true)
    setError(null)
    setSuccess(null)
    setTestedPayloadKey(null)

    try {
      const result = await window.hermesDesktop.testConnectionConfig(payload)

      if (!result.reachable) {
        throw new Error(sshResultError(result, copy))
      }

      setSuccess(copy.sshOnlyTestSucceeded(result.host || payload.sshHost || '', result.remotePlatform || ''))
      setTestedPayloadKey(payloadKey)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setTesting(false)
    }
  }

  const saveAndConnect = async () => {
    if (!tested || validationError) {
      setError(validationError || copy.sshOnlyTestFirst)

      return
    }

    setApplying(true)
    setError(null)

    try {
      // Persistence is deliberately separate and first. A failed owner-only
      // write leaves the form populated and never asks main to re-home.
      await window.hermesDesktop.saveConnectionConfig(payload)
      await window.hermesDesktop.applyConnectionConfig(payload)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  const disabled = testing || applying

  return (
    <div className="fixed inset-0 z-(--z-setup) flex items-center justify-center bg-background/90 p-4 backdrop-blur-md">
      <div className="flex w-full max-w-xl flex-col rounded-xl border border-(--stroke-nous) bg-card p-8 shadow-nous">
        <div className="flex items-start gap-4">
          <BrandMark className="size-11 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{copy.sshOnlySetupTitle}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{copy.sshOnlySetupDesc}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2" htmlFor="ssh-only-host">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyHostTitle}</span>
            <Input
              aria-label={copy.sshOnlyHostTitle}
              autoComplete="off"
              disabled={disabled}
              id="ssh-only-host"
              onChange={event => {
                invalidate()
                setHost(event.target.value)
              }}
              placeholder="100.64.0.1"
              value={host}
            />
            <span className="text-xs text-muted-foreground">{copy.sshOnlyHostDesc}</span>
          </label>

          <label className="grid gap-1.5" htmlFor="ssh-only-user">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyUserTitle}</span>
            <Input
              aria-label={copy.sshOnlyUserTitle}
              autoComplete="username"
              disabled={disabled}
              id="ssh-only-user"
              onChange={event => {
                invalidate()
                setUser(event.target.value)
              }}
              value={user}
            />
          </label>

          <label className="grid gap-1.5" htmlFor="ssh-only-port">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyPortTitle}</span>
            <Input
              aria-label={copy.sshOnlyPortTitle}
              disabled={disabled}
              id="ssh-only-port"
              inputMode="numeric"
              max={65535}
              min={1}
              onChange={event => {
                invalidate()
                setPort(event.target.value)
              }}
              type="number"
              value={port}
            />
          </label>

          <label className="grid gap-1.5 sm:col-span-2" htmlFor="ssh-only-identity">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyIdentityTitle}</span>
            <Input
              aria-label={copy.sshOnlyIdentityTitle}
              aria-readonly
              id="ssh-only-identity"
              readOnly
              value={SSH_ONLY_IDENTITY_PATH}
            />
            <span className="text-xs text-muted-foreground">{copy.sshOnlyIdentityDesc}</span>
          </label>

          <label className="grid gap-1.5 sm:col-span-2" htmlFor="ssh-only-hermes-path">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyHermesPathTitle}</span>
            <Input
              aria-label={copy.sshOnlyHermesPathTitle}
              disabled={disabled}
              id="ssh-only-hermes-path"
              onChange={event => {
                invalidate()
                setRemoteHermesPath(event.target.value)
              }}
              placeholder="/opt/hermes/bin/hermes"
              value={remoteHermesPath}
            />
          </label>

          <label className="grid gap-1.5 sm:col-span-2" htmlFor="ssh-only-profile">
            <span className="text-xs font-medium text-muted-foreground">{copy.sshOnlyProfileTitle}</span>
            <Input
              aria-label={copy.sshOnlyProfileTitle}
              disabled={disabled}
              id="ssh-only-profile"
              onChange={event => {
                invalidate()
                setRemoteProfile(event.target.value)
              }}
              placeholder="default"
              value={remoteProfile}
            />
          </label>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 flex items-start gap-2 text-sm text-emerald-500" role="status">
            <Check className="mt-0.5 size-4 shrink-0" />
            <span>{success}</span>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          {onBack ? (
            <Button disabled={disabled} onClick={onBack} type="button" variant="ghost">
              {copy.backToSetup}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              disabled={disabled || Boolean(validationError)}
              onClick={() => void testConnection()}
              type="button"
              variant="outline"
            >
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              {copy.sshOnlyTestConnection}
            </Button>
            <Button disabled={disabled || !tested} onClick={() => void saveAndConnect()} type="button">
              {applying ? <Loader2 className="size-4 animate-spin" /> : null}
              {copy.sshOnlyConnect}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
