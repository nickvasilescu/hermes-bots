export const COMPLETION_REF_KINDS = ['file', 'folder'] as const

export const COMPLETION_REF_META: Readonly<Record<(typeof COMPLETION_REF_KINDS)[number], string>> = Object.freeze({
  file: 'Reference a remote file',
  folder: 'Reference a remote folder'
})
