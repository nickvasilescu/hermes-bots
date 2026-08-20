/** The SSH-only plugin SDK deliberately has no cloud provisioning or
 * authenticated-service doors. Absence is the contract; inert credential
 * accepting stubs would preserve an attack surface and are not allowed. */
export const integrationHost = {}
