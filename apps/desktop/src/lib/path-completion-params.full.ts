interface PathCompletionParamsInput {
  cwd?: null | string
  sessionId?: null | string
  word: string
}

export function buildPathCompletionParams({ cwd, sessionId, word }: PathCompletionParamsInput) {
  return {
    word,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(cwd ? { cwd } : {})
  }
}
