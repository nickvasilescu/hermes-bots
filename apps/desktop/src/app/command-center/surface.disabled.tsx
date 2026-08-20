import type { ActionResponse } from '@/hermes'

export const COMMAND_CENTER_SECTIONS = ['sessions', 'system', 'usage'] as const

export type CommandCenterSystemAction = 'restart' | 'update'

export async function startCommandCenterSystemAction(_kind: CommandCenterSystemAction): Promise<ActionResponse> {
  throw new Error('System mutations are unavailable in the SSH client.')
}

export function CommandCenterSystemActions() {
  return null
}

export function MaintenancePanel() {
  return null
}
