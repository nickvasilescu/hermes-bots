import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuItem, dropdownMenuRow } from '@/components/ui/dropdown-menu'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { cn } from '@/lib/utils'
import type { ModelOptionsResponse } from '@/types/hermes'

interface ModelRefreshFooterProps {
  gateway?: HermesGateway
  profile: string
  sessionId: null | string
}

export function ModelRefreshFooter({ gateway, profile, sessionId }: ModelRefreshFooterProps) {
  const { t } = useI18n()
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()

  const refresh = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)

    try {
      const queryKey = modelOptionsQueryKey(profile, sessionId)
      const next = await requestModelOptions({ gateway, refresh: true, sessionId })

      queryClient.setQueryData<ModelOptionsResponse>(queryKey, next)
    } catch {
      void queryClient.invalidateQueries({ queryKey: ['model-options'] })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <DropdownMenuItem
      className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
      disabled={refreshing}
      onSelect={event => {
        event.preventDefault()
        void refresh()
      }}
    >
      <Codicon className={cn(refreshing && 'animate-spin')} name="sync" size="0.75rem" />
      {t.shell.modelMenu.refreshModels}
    </DropdownMenuItem>
  )
}
