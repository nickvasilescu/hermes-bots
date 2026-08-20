import { atom } from 'nanostores'

import type { DesktopUpdateStage, DesktopUpdateStatus, DesktopVersionInfo } from '@/global'

export interface UpdateApplyState {
  applying: boolean
  stage: DesktopUpdateStage
  message: string
  percent: number | null
  error: string | null
  command: string | null
  log: readonly { stage: DesktopUpdateStage; message: string; at: number }[]
}

const IDLE: UpdateApplyState = {
  applying: false,
  stage: 'idle',
  message: '',
  percent: null,
  error: null,
  command: null,
  log: []
}

export const $desktopVersion = atom<DesktopVersionInfo | null>(null)
export const $updateApply = atom<UpdateApplyState>(IDLE)
export const $updateStatus = atom<DesktopUpdateStatus | null>(null)
export const $backendUpdateApply = atom<UpdateApplyState>(IDLE)
export const $backendUpdateStatus = atom<DesktopUpdateStatus | null>(null)

export function openUpdateOverlayFor(_target: 'backend' | 'client'): void {}

export function openUpdatesWindow(): void {}

export function requestActiveUpdate(): void {}

export function startUpdatePoller(): void {}

export function stopUpdatePoller(): void {}

export function reportBackendContract(_contract: number | undefined): void {}

export function reportInstallMethodWarning(_message: string | undefined): void {}
