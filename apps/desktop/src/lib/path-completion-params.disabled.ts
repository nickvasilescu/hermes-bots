interface PathCompletionParamsInput {
  cwd?: null | string
  sessionId?: null | string
  word: string
}

const SAFE_RELATIVE_COMPLETION = /^@(file|folder):([A-Za-z0-9._/-]*)$/

export function buildPathCompletionParams({ sessionId, word }: PathCompletionParamsInput) {
  const match = SAFE_RELATIVE_COMPLETION.exec(word)
  const relative = match?.[2] ?? ''

  if (!match || relative.startsWith('/') || relative.split('/').includes('..') || relative.includes('//')) {
    return null
  }

  return { word, ...(sessionId ? { session_id: sessionId } : {}) }
}
