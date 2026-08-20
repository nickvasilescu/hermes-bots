import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { iconSize, Layers3, SteeringWheel } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type { ComposerControlsProps } from './controls'
import { ModelPill } from './model-pill'

const ICON_BTN = 'size-(--composer-control-size) shrink-0 rounded-md'

const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

const PRIMARY_ICON_BTN = cn(
  'size-(--composer-control-primary-size,var(--composer-control-size)) shrink-0 rounded-full p-0',
  'bg-foreground text-background hover:bg-foreground/90',
  'disabled:bg-foreground/30 disabled:text-background disabled:opacity-100'
)

export function ComposerControls({
  busy,
  busyAction,
  canSubmit,
  compactModelPill = false,
  disabled,
  onQueue,
  state
}: ComposerControlsProps) {
  const { t } = useI18n()
  const c = t.composer
  const busyLabel = busyAction === 'queue' ? c.queueMessage : busyAction === 'steer' ? c.steer : c.stop

  return (
    <div className="ml-auto flex shrink-0 items-center gap-(--composer-control-gap)">
      <span className="contents" data-slot="composer-model-control">
        <ModelPill compact={compactModelPill} disabled={disabled} model={state.model} />
      </span>
      {busyAction === 'steer' ? (
        <span className="contents" data-slot="composer-queue-control">
          <Tip label={<TipKeybindLabel actionId="composer.queue" text={c.queueMessage} />}>
            <Button
              aria-label={c.queueMessage}
              className={GHOST_ICON_BTN}
              disabled={disabled}
              onClick={onQueue}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Layers3 className={iconSize.sm} />
            </Button>
          </Tip>
        </span>
      ) : null}
      <Tip
        label={
          busy ? (
            <TipKeybindLabel
              actionId={
                busyAction === 'steer' ? 'composer.steer' : busyAction === 'queue' ? 'composer.queue' : 'composer.send'
              }
              text={busyLabel}
            />
          ) : (
            <TipKeybindLabel actionId="composer.send" text={c.send} />
          )
        }
      >
        <Button
          aria-label={busy ? busyLabel : c.send}
          className={PRIMARY_ICON_BTN}
          disabled={disabled || !canSubmit}
          type="submit"
        >
          {busy ? (
            busyAction === 'queue' ? (
              <Layers3 className={iconSize.sm} />
            ) : busyAction === 'steer' ? (
              <SteeringWheel className={iconSize.sm} />
            ) : (
              <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
            )
          ) : (
            <Codicon name="arrow-up" size="0.875rem" />
          )}
        </Button>
      </Tip>
    </div>
  )
}
