export function PreviewAttachment({ target }: { source?: string; target: string }) {
  return <span className="wrap-anywhere text-muted-foreground">{target}</span>
}
