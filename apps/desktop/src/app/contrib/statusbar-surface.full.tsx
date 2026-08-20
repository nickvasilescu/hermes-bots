import { useStatusbarContributions } from '@desktop/local-panes'
import { useStore } from '@nanostores/react'

import { $freshDraftReady, $gatewayState } from '@/store/session'

import { useStatusSnapshot } from '../shell/hooks/use-status-snapshot'
import { useStatusbarItems } from '../shell/hooks/use-statusbar-items'
import { StatusbarControls } from '../shell/statusbar-controls'

import type { WiringActions } from './types'

export function StatusbarSurface({
  actions,
  agentsOpen,
  chatOpen,
  commandCenterOpen
}: {
  actions: WiringActions
  agentsOpen: boolean
  chatOpen: boolean
  commandCenterOpen: boolean
}) {
  const gatewayState = useStore($gatewayState)
  const freshDraftReady = useStore($freshDraftReady)
  const { inferenceStatus, statusSnapshot } = useStatusSnapshot(gatewayState, actions.requestGateway)
  const extraLeftItems = useStatusbarContributions('left')
  const extraRightItems = useStatusbarContributions('right')

  const { leftStatusbarItems, statusbarItems } = useStatusbarItems({
    agentsOpen,
    chatOpen,
    commandCenterOpen,
    extraLeftItems,
    extraRightItems,
    freshDraftReady,
    gatewayState,
    inferenceStatus,
    openAgents: actions.openAgents,
    openCommandCenterSection: actions.openCommandCenterSection,
    requestGateway: actions.requestGateway,
    statusSnapshot,
    toggleCommandCenter: actions.toggleCommandCenter
  })

  return <StatusbarControls items={statusbarItems} leftItems={leftStatusbarItems} />
}
