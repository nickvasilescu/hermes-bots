/** SSH-only clients never scan, load, or reload Mini-hosted desktop plugins. */
export async function discoverRuntimePlugins(): Promise<void> {}

export function watchRuntimePlugins(): void {}
