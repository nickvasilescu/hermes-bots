type SshHostState = {
  sshHost: string
  sshUser: string
  sshPort: number | null
  sshKeyPath: string
  sshRemoteHermesPath: string
}

type ResolvedSshHost = {
  identityFile?: string | null
  port?: number | null
  user?: string | null
}

function isNumericTailscaleIp(value: string): boolean {
  const host = value.trim().toLowerCase()
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)

  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)

    return octets.every(octet => octet >= 0 && octet <= 255) && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
  }

  if (!host.startsWith('fd7a:115c:a1e0:') || !/^[0-9a-f:]+$/.test(host)) {
    return false
  }

  const halves = host.split('::')

  if (halves.length > 2) {
    return false
  }

  const groups = halves.flatMap(half => (half ? half.split(':') : []))

  if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) {
    return false
  }

  return halves.length === 2 ? groups.length < 8 : groups.length === 8
}

function selectSshHost<T extends SshHostState>(state: T, host: string): T {
  if (host === state.sshHost) {
    return state
  }

  return {
    ...state,
    sshHost: host,
    sshUser: '',
    sshPort: null,
    sshKeyPath: '',
    sshRemoteHermesPath: ''
  }
}

function enrichSelectedSshHost<T extends SshHostState>(state: T, host: string, resolved: ResolvedSshHost): T {
  if (state.sshHost !== host) {
    return state
  }

  return {
    ...state,
    sshUser: state.sshUser || resolved.user || '',
    sshPort: state.sshPort ?? (resolved.port === 22 ? null : (resolved.port ?? null)),
    sshKeyPath: state.sshKeyPath || resolved.identityFile || ''
  }
}

export { enrichSelectedSshHost, isNumericTailscaleIp, selectSshHost }
