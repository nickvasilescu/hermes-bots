import type { ToolCallMessagePartProps } from '@assistant-ui/react'

import { ToolFallback } from '@/components/assistant-ui/tool/fallback'

/** Render the transcript row without exposing install, auth, or env actions. */
export function McpSetupTool(props: ToolCallMessagePartProps) {
  return <ToolFallback {...props} />
}
