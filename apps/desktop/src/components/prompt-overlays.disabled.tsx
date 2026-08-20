import { PendingApprovalFallback } from '@/components/assistant-ui/tool/approval'

export function PromptOverlays(_props: { sessionId: string | null }) {
  return <PendingApprovalFallback />
}
