/** The SSH client has no local provider-setup recovery surface. */
export function isProviderSetupErrorMessage(_message: null | string | undefined): boolean {
  return false
}
