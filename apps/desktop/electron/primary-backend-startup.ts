import type { FirstRunSetupDecision } from './first-run-setup-gate'

export interface PrimaryBackendStartupOptions<Backend, RuntimeBackend, Remote, Connection> {
  connectRemote: (remote: Remote) => Promise<Connection>
  ensureLocalRuntime: (backend: Backend) => Promise<RuntimeBackend>
  prepareLocalBackend: () => Backend | Promise<Backend>
  resolveRemote: () => Promise<Remote | null>
  sshOnly?: boolean
  onSshOnlyConfigurationRequired?: (error: SshOnlyConfigurationError) => void
  waitForDecision: (backend: Backend) => Promise<FirstRunSetupDecision>
  waitForLocalStart: () => Promise<unknown>
}

export type PrimaryBackendStartupResult<RuntimeBackend, Connection> =
  { kind: 'local'; backend: RuntimeBackend } | { kind: 'remote'; connection: Connection }

export class FirstRunSetupResetError extends Error {
  readonly firstRunSetupReset = true

  constructor() {
    super('First-run setup was reset before a choice completed.')
    this.name = 'FirstRunSetupResetError'
  }
}

export class SshOnlyConfigurationError extends Error {
  readonly code = 'ssh-only-configuration-required'
  readonly sshOnlyConfigurationError = true

  constructor(message = 'Configure the SSH-only connection before starting Korgo Bot.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshOnlyConfigurationError'
  }
}

// Owns the production startHermes path up to the local process spawn. Keeping
// the full ordering here makes the first-run remote boundary executable in a
// test: an already-saved remote wins immediately; otherwise update exclusion
// and local backend resolution happen before the setup gate, and a remote Apply
// re-resolves persisted config without ever entering ensureRuntime/bootstrap.
export async function runPrimaryBackendStartup<Backend, RuntimeBackend, Remote, Connection>({
  connectRemote,
  ensureLocalRuntime,
  prepareLocalBackend,
  resolveRemote,
  sshOnly = false,
  onSshOnlyConfigurationRequired,
  waitForDecision,
  waitForLocalStart
}: PrimaryBackendStartupOptions<Backend, RuntimeBackend, Remote, Connection>): Promise<
  PrimaryBackendStartupResult<RuntimeBackend, Connection>
> {
  let savedRemote

  try {
    savedRemote = await resolveRemote()
  } catch (cause) {
    if (!sshOnly) {
      throw cause
    }

    const error = new SshOnlyConfigurationError(
      cause instanceof Error ? cause.message : 'The saved SSH-only connection is invalid.',
      { cause }
    )

    onSshOnlyConfigurationRequired?.(error)
    throw error
  }

  if (savedRemote) {
    return { kind: 'remote', connection: await connectRemote(savedRemote) }
  }

  if (sshOnly) {
    const error = new SshOnlyConfigurationError()
    onSshOnlyConfigurationRequired?.(error)
    throw error
  }

  await waitForLocalStart()

  const backend = await prepareLocalBackend()
  const decision = await waitForDecision(backend)

  if (decision === 'remote-applied') {
    const appliedRemote = await resolveRemote()

    if (!appliedRemote) {
      throw new Error('First-run remote setup completed without a saved remote backend.')
    }

    return { kind: 'remote', connection: await connectRemote(appliedRemote) }
  }

  if (decision === 'reset') {
    throw new FirstRunSetupResetError()
  }

  return { kind: 'local', backend: await ensureLocalRuntime(backend) }
}
