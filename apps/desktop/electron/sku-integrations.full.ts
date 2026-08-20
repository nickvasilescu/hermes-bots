import { fetchMarketplaceThemes, searchMarketplaceThemes } from './vscode-marketplace'

/**
 * Full-product-only integration boundary. The callback keeps the large
 * existing handler bodies in main.ts while giving the SSH-only bundle a
 * compile-time module replacement with no registrar at all.
 */
export function registerSkuIntegrations(register: () => void): void {
  register()
}

interface MarketplaceThemeIpc {
  handle: (channel: string, listener: (...args: any[]) => unknown) => void
}

export function registerMarketplaceThemeHandlers(ipc: MarketplaceThemeIpc): void {
  ipc.handle('hermes:vscode-theme:fetch', async (_event, id) => fetchMarketplaceThemes(String(id || '')))
  ipc.handle('hermes:vscode-theme:search', async (_event, query) => searchMarketplaceThemes(String(query || ''), 20))
}
