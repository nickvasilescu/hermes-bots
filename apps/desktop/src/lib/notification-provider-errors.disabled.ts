/** SSH never classifies provider credential setup errors because it cannot configure providers. */
export function summarizeProviderCredentialError(_message: string): null {
  return null
}
