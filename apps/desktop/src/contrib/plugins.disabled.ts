/**
 * SSH-only clients do not load bundled or on-disk desktop plugins. Plugin
 * registration can expose Mini-owned configuration and mutation surfaces even
 * when their navigation is hidden, so this SKU keeps the contribution graph
 * closed at its boot entrypoint.
 */
export function discoverBundledPlugins(): void {}
