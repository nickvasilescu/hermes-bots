// Only chat/session events cross the SSH renderer boundary. Mini-owned setup
// and credential prompts are deliberately absent from this build graph.
export const UNSCOPED_STREAM_EVENT_TYPES = [
  'approval.request',
  'browser.progress',
  'clarify.request',
  'error',
  'message.complete',
  'message.delta',
  'message.interim',
  'message.start',
  'reasoning.available',
  'reasoning.delta',
  'status.update',
  'thinking.delta',
  'tool.complete',
  'tool.generating',
  'tool.progress',
  'tool.start'
] as const
