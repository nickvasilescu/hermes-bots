interface ProjectConfig {
  branch?: string
  cwd?: string
}

type GatewayRequester = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export function getProjectConfig(requestGateway: GatewayRequester, cwd: string): Promise<ProjectConfig> {
  return requestGateway<ProjectConfig>('config.get', { key: 'project', cwd })
}
