import { useMessagePartText } from '@assistant-ui/react'
import { type ComponentProps, memo } from 'react'

import { cn } from '@/lib/utils'

interface MarkdownTextSurfaceProps {
  containerClassName?: string
  containerProps?: ComponentProps<'div'>
  defer?: boolean
  disableArtifacts?: boolean
}

interface MarkdownTextContentProps extends MarkdownTextSurfaceProps {
  isRunning: boolean
  text: string
}

function StaticTranscriptText({
  containerClassName,
  containerProps,
  text
}: MarkdownTextSurfaceProps & { text: string }) {
  return (
    <div
      className={cn(
        'aui-md w-full max-w-none whitespace-pre-wrap wrap-anywhere text-[length:var(--conversation-text-font-size)] leading-(--dt-line-height) text-foreground',
        containerClassName
      )}
      {...containerProps}
    >
      {text}
    </div>
  )
}

export function MarkdownTextContent({ text, ...surfaceProps }: MarkdownTextContentProps) {
  return <StaticTranscriptText text={text} {...surfaceProps} />
}

const MarkdownTextImpl = () => {
  const { text } = useMessagePartText()

  return <StaticTranscriptText text={text} />
}

export const MarkdownText = memo(MarkdownTextImpl)
