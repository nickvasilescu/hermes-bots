import { useEffect, useState } from 'react'

import { syncConnectorsToRoster } from '@/app/connectors/provision'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesktopTailscaleStatus } from '@/global'
import { getGlobalModelInfo } from '@/hermes'
import { Loader2 } from '@/lib/icons'
import { isBotProduct, isSshOnlyProduct } from '@/lib/product'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'hermes-bot-setup-v2'
export const BOT_PROVIDER_SETUP_READY_EVENT = 'hermes-bots:provider-setup-ready'
export const BOT_PROVIDER_SETUP_COMPLETE_EVENT = 'hermes-bots:provider-setup-complete'
export const BOT_FIRST_PROFILE_EVENT = 'hermes-bots:first-profile'

type SetupStep = 'bot' | 'composio' | 'orgo' | 'provider' | 'ready' | 'tailscale'

interface SetupState {
  botModel?: string
  botProfile?: string
  botProvider?: string
  complete: boolean
  skipped: boolean
  step: SetupStep
}

type OrgoProvisioningStage = 'checking-mac' | 'private-network' | 'provisioning' | 'saving-key'

const ORGO_PROVISIONING_COPY: Record<OrgoProvisioningStage, { detail: string; title: string }> = {
  'saving-key': {
    title: 'Checking your Orgo connection',
    detail: 'Securely saving the API key and preparing your workspace.'
  },
  provisioning: {
    title: 'Preparing your cloud computer',
    detail: 'Creating the computer, installing Hermes, and applying your wallpaper. This can take a few minutes.'
  },
  'private-network': {
    title: 'Starting the private connection',
    detail: 'Installing Tailscale on the cloud computer and requesting its secure sign-in link.'
  },
  'checking-mac': {
    title: 'Checking this Mac',
    detail: 'Confirming whether this Mac is ready to join the private connection.'
  }
}

export function formatBotSetupError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error || '')

  const detail = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^OrgoDesktopError:\s*/i, '')
    .trim()

  if (/(?:context cancel+ed|deadline exceeded)/i.test(detail)) {
    return 'Your cloud computer is ready, but the private connection took too long to start. Try “Authorize cloud computer” again.'
  }

  if (/"BackendState"\s*:/.test(detail)) {
    return 'Tailscale is installed on the cloud computer, but it did not provide a sign-in link. Try authorizing again.'
  }

  return detail.length > 600 ? `${detail.slice(0, 600)}…` : detail || fallback
}

function OrgoProvisioningProgress({ stage }: { stage: OrgoProvisioningStage }) {
  const copy = ORGO_PROVISIONING_COPY[stage]

  return (
    <div
      aria-live="polite"
      className="rounded-xl border border-border/70 bg-primary/[0.05] p-3"
      data-stage={stage}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{copy.title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.detail}</div>
        </div>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-primary/10">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary/55" />
      </div>
    </div>
  )
}

export interface FirstBotProfile {
  model: string
  name: string
  provider: string
}

function readSetup(): SetupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return { complete: false, skipped: false, step: 'orgo' }
    }

    const parsed = JSON.parse(raw) as Partial<SetupState>

    const step: SetupStep =
      parsed.step === 'tailscale' ||
      parsed.step === 'provider' ||
      parsed.step === 'bot' ||
      parsed.step === 'composio' ||
      parsed.step === 'ready'
        ? parsed.step
        : 'orgo'

    return {
      botModel: typeof parsed.botModel === 'string' ? parsed.botModel : undefined,
      botProfile: typeof parsed.botProfile === 'string' ? parsed.botProfile : undefined,
      botProvider: typeof parsed.botProvider === 'string' ? parsed.botProvider : undefined,
      complete: Boolean(parsed.complete),
      skipped: Boolean(parsed.skipped),
      step
    }
  } catch {
    return { complete: false, skipped: false, step: 'orgo' }
  }
}

function writeSetup(state: SetupState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function isBotProviderSetupReady(): boolean {
  const setup = readSetup()

  return setup.complete || setup.skipped || !['orgo', 'tailscale'].includes(setup.step)
}

export function markBotProviderSetupComplete(): void {
  window.dispatchEvent(new CustomEvent(BOT_PROVIDER_SETUP_COMPLETE_EVENT))
}

function announceProviderSetupReady(): void {
  window.dispatchEvent(new CustomEvent(BOT_PROVIDER_SETUP_READY_EVENT))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export async function createFirstBotProfile(
  titleValue: string,
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
): Promise<FirstBotProfile> {
  const title = titleValue.trim() || 'Assistant'
  const name = slugify(title) || 'assistant'
  const modelInfo = await getGlobalModelInfo()
  const model = String(modelInfo.model || '').trim()
  const provider = String(modelInfo.provider || '').trim()

  if (!model || !provider) {
    throw new Error('The connected GPT or Grok model could not be resolved. Reconnect the provider and try again.')
  }

  await requestGateway('profiles.create', {
    name,
    description: title,
    clone_from: null,
    no_skills: false,
    model,
    provider
  })

  return { model, name, provider }
}

function announceFirstBotProfile(profile: FirstBotProfile, open: boolean): void {
  window.dispatchEvent(
    new CustomEvent(BOT_FIRST_PROFILE_EVENT, {
      detail: { ...profile, open }
    })
  )
}

function StatusRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-primary/[0.06] p-3.5">
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
          ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-primary/10 text-muted-foreground'
        )}
      >
        {ok ? '✓' : '–'}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

export function BotSetupOverlay({
  enabled,
  requestGateway
}: {
  enabled: boolean
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  if (isSshOnlyProduct()) {
    return null
  }

  return <FullBotSetupOverlay enabled={enabled} requestGateway={requestGateway} />
}

function FullBotSetupOverlay({
  enabled,
  requestGateway
}: {
  enabled: boolean
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const [setup, setSetup] = useState<SetupState>({ complete: false, skipped: false, step: 'orgo' })
  const [botName, setBotName] = useState('Assistant')
  const [composioKey, setComposioKey] = useState('')
  const [orgoKey, setOrgoKey] = useState('')
  const [localTailscale, setLocalTailscale] = useState<DesktopTailscaleStatus | null>(null)
  const [remoteTailscale, setRemoteTailscale] = useState<DesktopTailscaleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [orgoProvisioningStage, setOrgoProvisioningStage] = useState<null | OrgoProvisioningStage>(null)

  const [doctor, setDoctor] = useState<{
    provider: boolean
    bot: boolean
    composio: boolean
    orgo: boolean
  }>({ provider: false, bot: false, composio: false, orgo: false })

  useEffect(() => {
    let cancelled = false
    const stored = readSetup()
    setSetup(stored)

    if (stored.step === 'orgo') {
      const status = window.hermesDesktop?.orgoDesktop.status()

      if (status) {
        void status
          .then(config => {
            if (cancelled || !config.apiKeySet || !config.computerId) {
              return
            }

            setSetup(current => {
              if (current.step !== 'orgo') {
                return current
              }

              const next = { ...current, step: 'tailscale' as const }
              writeSetup(next)

              return next
            })
          })
          .catch(() => undefined)
      }
    }

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const completeProvider = () => {
      setDoctor(current => ({ ...current, provider: true }))
      setSetup(current => {
        if (current.step !== 'provider') {
          return current
        }

        const next = { ...current, step: 'bot' as const }
        writeSetup(next)

        return next
      })
    }

    window.addEventListener(BOT_PROVIDER_SETUP_COMPLETE_EVENT, completeProvider)

    return () => window.removeEventListener(BOT_PROVIDER_SETUP_COMPLETE_EVENT, completeProvider)
  }, [])

  useEffect(() => {
    if (setup.step !== 'tailscale' || busy) {
      return undefined
    }

    let cancelled = false

    const refresh = async () => {
      try {
        const [local, remote] = await Promise.all([
          window.hermesDesktop?.orgoDesktop.tailscaleLocalStatus(),
          window.hermesDesktop?.orgoDesktop.tailscaleStatus()
        ])

        if (!cancelled) {
          setLocalTailscale(local || null)
          setRemoteTailscale(remote || null)
        }
      } catch {
        // Setup buttons surface actionable errors; polling stays quiet.
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [busy, setup.step])

  if (!isBotProduct() || !enabled || setup.complete || setup.skipped) {
    return null
  }

  if (setup.step === 'provider') {
    return null
  }

  const finish = (skipped = false) => {
    const next: SetupState = { ...setup, complete: true, skipped, step: 'ready' }
    writeSetup(next)
    setSetup(next)

    if (setup.botProfile && setup.botModel && setup.botProvider) {
      announceFirstBotProfile(
        {
          model: setup.botModel,
          name: setup.botProfile,
          provider: setup.botProvider
        },
        true
      )
    }
  }

  const goToStep = (step: SetupStep) => {
    setSetup(current => {
      const next = { ...current, step }
      writeSetup(next)

      return next
    })
  }

  const useLocalHermes = () => {
    goToStep('provider')
    announceProviderSetupReady()
  }

  const createBot = async () => {
    setBusy(true)
    setError('')

    try {
      const profile = await createFirstBotProfile(botName, requestGateway)

      setSetup(current => {
        const next = {
          ...current,
          botModel: profile.model,
          botProfile: profile.name,
          botProvider: profile.provider,
          step: 'composio' as const
        }

        writeSetup(next)

        return next
      })
      announceFirstBotProfile(profile, false)
      await syncConnectorsToRoster([{ name: profile.name }]).catch(() => undefined)
      setDoctor(current => ({ ...current, bot: true, provider: true }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the first bot.')
    } finally {
      setBusy(false)
    }
  }

  const saveComposio = async () => {
    setBusy(true)
    setError('')

    try {
      const key = composioKey.trim()

      if (key) {
        await window.hermesDesktop?.connectors?.saveKey(key)
        await syncConnectorsToRoster()
      }

      setDoctor(current => ({ ...current, composio: Boolean(key), provider: true }))
      goToStep('ready')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the Connect apps key.')
    } finally {
      setBusy(false)
    }
  }

  const saveOrgo = async () => {
    setBusy(true)
    setError('')

    try {
      const key = orgoKey.trim()

      if (!key) {
        goToStep('provider')
        announceProviderSetupReady()

        return
      }

      setOrgoProvisioningStage('saving-key')
      await window.hermesDesktop?.orgoDesktop.saveKey(key)
      setOrgoProvisioningStage('provisioning')
      const provisioned = await window.hermesDesktop?.orgoDesktop.provision()

      if (!provisioned?.computerId) {
        throw new Error('Orgo did not return a shared computer.')
      }

      // Persist the completed provisioning boundary before Tailscale begins.
      // If private-network setup is interrupted, onboarding resumes here and
      // retries authorization instead of recreating the already-ready computer.
      goToStep('tailscale')
      setOrgoProvisioningStage('private-network')

      let remote: DesktopTailscaleStatus | undefined

      try {
        remote = await window.hermesDesktop?.orgoDesktop.beginTailscale()
      } catch (caught) {
        setError(formatBotSetupError(caught, 'Could not start Tailscale on the shared computer.'))

        return
      }

      setOrgoProvisioningStage('checking-mac')
      const local = await window.hermesDesktop?.orgoDesktop.tailscaleLocalStatus()
      setRemoteTailscale(remote || null)
      setLocalTailscale(local || null)
    } catch (caught) {
      setError(formatBotSetupError(caught, 'Could not set up the shared computer.'))
    } finally {
      setOrgoProvisioningStage(null)
      setBusy(false)
    }
  }

  const openTailscale = async () => {
    setBusy(true)
    setError('')

    try {
      await window.hermesDesktop?.orgoDesktop.openTailscale()
      const local = await window.hermesDesktop?.orgoDesktop.tailscaleLocalStatus()
      setLocalTailscale(local || null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open Tailscale.')
    } finally {
      setBusy(false)
    }
  }

  const authorizeComputer = async () => {
    setBusy(true)
    setError('')

    try {
      const remote = await window.hermesDesktop?.orgoDesktop.beginTailscale()
      setRemoteTailscale(remote || null)
    } catch (caught) {
      setError(formatBotSetupError(caught, 'Could not start Tailscale on the shared computer.'))
    } finally {
      setBusy(false)
    }
  }

  const connectCloudHermes = async () => {
    setBusy(true)
    setError('')

    try {
      const result = await window.hermesDesktop?.orgoDesktop.connectRemoteHermes()

      if (!result?.connection || result.connection.mode !== 'ssh') {
        throw new Error('Hermes did not switch to the shared computer.')
      }

      setDoctor(current => ({ ...current, orgo: true }))
      goToStep('provider')
      announceProviderSetupReady()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect Hermes to the shared computer.')
    } finally {
      setBusy(false)
    }
  }

  const heading =
    setup.step === 'orgo'
      ? 'Your cloud computer'
      : setup.step === 'tailscale'
        ? 'Private cloud connection'
        : setup.step === 'bot'
          ? 'Name your first bot'
          : setup.step === 'composio'
            ? 'Connect apps'
            : 'Ready'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Korgo Bot</div>
        <h1 className="mt-1 text-xl font-semibold">{heading}</h1>
        {setup.step === 'orgo' ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm text-muted-foreground">
              Add Orgo to keep Hermes, every bot, and their memory running in the cloud. Skip only if you want this Mac
              to host Hermes.
            </p>
            <Input
              disabled={busy}
              onChange={event => setOrgoKey(event.target.value)}
              placeholder="Orgo API key"
              type="password"
              value={orgoKey}
            />
            <Button aria-busy={busy} disabled={busy} onClick={() => void saveOrgo()}>
              {busy && orgoProvisioningStage ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              {busy && orgoProvisioningStage
                ? ORGO_PROVISIONING_COPY[orgoProvisioningStage].title
                : orgoKey.trim()
                  ? 'Create cloud computer'
                  : 'Use this Mac instead'}
            </Button>
            {busy && orgoProvisioningStage ? <OrgoProvisioningProgress stage={orgoProvisioningStage} /> : null}
          </div>
        ) : null}
        {setup.step === 'tailscale' ? (
          <div className="mt-4 grid gap-2">
            <p className="mb-1 text-sm text-muted-foreground">
              Tailscale gives this Mac a private SSH connection to Hermes on your Orgo computer.
            </p>
            {busy && orgoProvisioningStage ? <OrgoProvisioningProgress stage={orgoProvisioningStage} /> : null}
            <StatusRow
              detail={
                localTailscale?.connected
                  ? localTailscale.dnsName || 'This Mac is connected.'
                  : localTailscale?.installed
                    ? 'Open Tailscale and sign in.'
                    : 'Install Tailscale, then sign in.'
              }
              ok={Boolean(localTailscale?.connected)}
              title="This Mac"
            />
            <StatusRow
              detail={
                remoteTailscale?.connected
                  ? remoteTailscale.dnsName
                  : remoteTailscale?.authUrl
                    ? 'Approve the computer in the browser window.'
                    : 'Start authorization to add it to your tailnet.'
              }
              ok={Boolean(remoteTailscale?.connected)}
              title="Cloud computer"
            />
            {!localTailscale?.connected ? (
              <Button disabled={busy} onClick={() => void openTailscale()} variant="secondary">
                {localTailscale?.installed ? 'Open Tailscale' : 'Get Tailscale'}
              </Button>
            ) : null}
            {!remoteTailscale?.connected ? (
              <Button disabled={busy} onClick={() => void authorizeComputer()} variant="secondary">
                Authorize cloud computer
              </Button>
            ) : null}
            <Button
              disabled={busy || !localTailscale?.connected || !remoteTailscale?.connected}
              onClick={() => void connectCloudHermes()}
            >
              Connect Hermes
            </Button>
          </div>
        ) : null}
        {setup.step === 'bot' ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm text-muted-foreground">
              This is the bot you will land in after setup. You can add more later.
            </p>
            <Input autoFocus onChange={event => setBotName(event.target.value)} value={botName} />
            <Button disabled={busy} onClick={() => void createBot()}>
              Continue
            </Button>
          </div>
        ) : null}
        {setup.step === 'composio' ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm text-muted-foreground">
              Optional. Paste a Composio Connect key (`ck_…`) to give every bot the same apps.
            </p>
            <Input onChange={event => setComposioKey(event.target.value)} placeholder="ck_…" value={composioKey} />
            <Button disabled={busy} onClick={() => void saveComposio()}>
              {composioKey.trim() ? 'Save and continue' : 'Skip for now'}
            </Button>
          </div>
        ) : null}
        {setup.step === 'ready' ? (
          <div className="mt-4 grid gap-2">
            <StatusRow detail="Codex or Grok is connected." ok={doctor.provider} title="Runtime + model" />
            <StatusRow detail="Ready to chat." ok={doctor.bot} title="First bot" />
            <StatusRow
              detail={doctor.composio ? 'Key saved for every bot.' : 'Skipped — add later from Connectors.'}
              ok={doctor.composio}
              title="Connect apps"
            />
            <StatusRow
              detail={
                doctor.orgo ? 'Computer is selected and MCP is ready.' : 'Skipped — add later from the computer drawer.'
              }
              ok={doctor.orgo}
              title="Shared computer"
            />
            <Button className="mt-2" onClick={() => finish(false)}>
              Open Bot Chat
            </Button>
          </div>
        ) : null}
        {error ? <p className="mt-3 max-h-28 overflow-y-auto break-words text-sm text-destructive">{error}</p> : null}
        {setup.step === 'tailscale' ? (
          <button className="mt-4 text-xs text-muted-foreground underline" onClick={useLocalHermes} type="button">
            Use this Mac instead
          </button>
        ) : setup.step !== 'ready' && setup.step !== 'orgo' ? (
          <button className="mt-4 text-xs text-muted-foreground underline" onClick={() => finish(true)} type="button">
            Skip remaining setup
          </button>
        ) : null}
      </div>
    </div>
  )
}
