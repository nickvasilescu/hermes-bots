interface WebhooksViewProps {
  onClose: () => void
}

export function WebhooksView({ onClose: _onClose }: WebhooksViewProps) {
  return (
    <section className="grid min-h-0 flex-1 place-items-center px-6 text-center">
      <div>
        <h2 className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">Webhooks</h2>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          Webhooks are managed on the Mini.
        </p>
      </div>
    </section>
  )
}
