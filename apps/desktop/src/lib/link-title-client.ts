// The default/full-product implementation. SSH-only builds alias this module
// to link-title-client.disabled.ts at bundle time so the network bridge and its
// channel name never enter the renderer artifact.
export * from './link-title-client.full'
