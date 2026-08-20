// The SSH-only entry point exports no registrar. Keeping the capability absent
// makes raw IPC invokes fail closed instead of accepting sensitive arguments in
// a no-op implementation.
export const registerSkuIntegrations = undefined
export const registerMarketplaceThemeHandlers = undefined
