interface ProjectConfig {
  branch?: string
  cwd?: string
}

type GatewayRequester = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/** SSH sessions do not inspect or resolve Mini-owned project paths. */
export function getProjectConfig(_requestGateway: GatewayRequester, _cwd: string): Promise<ProjectConfig> {
  return Promise.resolve({})
}
