interface SessionTitleProps {
  title: string
}

export function SessionTitle({ title }: SessionTitleProps) {
  return <span className="truncate text-sm font-medium text-foreground">{title}</span>
}
