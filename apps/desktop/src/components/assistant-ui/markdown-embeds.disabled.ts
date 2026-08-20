export { extractAlert, MarkdownAlert } from './embeds/alert'
export { RICH_FENCE_LANGUAGES, RichCodeBlock } from './embeds/registry'

export type EmbedDescriptor = never

export function detectEmbed(_rawUrl: null | string | undefined): null {
  return null
}

export function isEmbeddableUrl(_rawUrl: null | string | undefined): false {
  return false
}

/** External rich embeds are unavailable in the network-isolated SSH renderer. */
export function UrlEmbed(_props: { descriptor: EmbedDescriptor }): null {
  return null
}
