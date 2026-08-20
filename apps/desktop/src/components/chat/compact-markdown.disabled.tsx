import { memo } from 'react'

import { cn } from '@/lib/utils'

export const CompactMarkdown = memo(function CompactMarkdown({
  className,
  text
}: {
  className?: string
  text: string
}) {
  return (
    <div
      className={cn(
        'max-w-full whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/90 wrap-anywhere',
        className
      )}
    >
      {text}
    </div>
  )
})
