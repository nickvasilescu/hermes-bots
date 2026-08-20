import { Codicon } from '@/components/ui/codicon'

import { CRON_ROUTE, MESSAGING_ROUTE, SKILLS_ROUTE } from '../../routes'
import type { SidebarNavItem } from '../../types'

export const SIDEBAR_MINI_OWNED_NAV: SidebarNavItem[] = [
  {
    id: 'skills',
    label: '',
    icon: props => <Codicon name="symbol-misc" {...props} />,
    route: SKILLS_ROUTE,
    keybindActionId: 'nav.skills'
  },
  {
    id: 'messaging',
    label: '',
    icon: props => <Codicon name="comment" {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging'
  },
  {
    id: 'cron',
    label: '',
    icon: props => <Codicon name="watch" {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron'
  }
]
