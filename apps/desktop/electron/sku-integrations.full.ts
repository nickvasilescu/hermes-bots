/**
 * Full-product-only integration boundary. The callback keeps the large
 * existing handler bodies in main.ts while giving the SSH-only bundle a
 * compile-time module replacement with no registrar at all.
 */
export function registerSkuIntegrations(register: () => void): void {
  register()
}
