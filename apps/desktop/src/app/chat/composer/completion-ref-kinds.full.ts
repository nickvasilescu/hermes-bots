export const COMPLETION_REF_KINDS = ['file', 'folder', 'url', 'image', 'tool', 'git'] as const

export const COMPLETION_REF_META: Readonly<Record<(typeof COMPLETION_REF_KINDS)[number], string>> = Object.freeze({
  file: 'Attach a file reference',
  folder: 'Attach a folder reference',
  url: 'Attach a URL reference',
  image: 'Attach an image reference',
  tool: 'Attach a tool reference',
  git: 'Attach git context'
})
