import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { restartGateway, updateHermes } from '@/hermes'
import type { ActionResponse } from '@/hermes'

import { MaintenancePanel } from './maintenance'

export const COMMAND_CENTER_SECTIONS = ['sessions', 'system', 'usage', 'maintenance'] as const

export type CommandCenterSystemAction = 'restart' | 'update'

export function startCommandCenterSystemAction(kind: CommandCenterSystemAction): Promise<ActionResponse> {
  return kind === 'restart' ? restartGateway() : updateHermes()
}

interface SystemActionsProps {
  copy: { restartGateway: string; updateHermes: string }
  onRun: (kind: CommandCenterSystemAction) => void
}

export function CommandCenterSystemActions({ copy, onRun }: SystemActionsProps) {
  const shared: Pick<ComponentProps<typeof Button>, 'size'> = { size: 'xs' }

  return (
    <>
      <Button {...shared} onClick={() => onRun('restart')} variant="text">
        {copy.restartGateway}
      </Button>
      <Button {...shared} onClick={() => onRun('update')} variant="textStrong">
        {copy.updateHermes}
      </Button>
    </>
  )
}

export { MaintenancePanel }
