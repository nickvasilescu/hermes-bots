interface SessionTileResumePayloadInput {
  profile?: null | string
  sessionId: string
}

export function buildSessionTileResumePayload({ profile, sessionId }: SessionTileResumePayloadInput) {
  return { session_id: sessionId, cols: 96, omit_messages: true, ...(profile ? { profile } : {}) }
}
