import { type PaletteContribution, paletteToggle } from '@/app/command-palette/contrib'
import { Zap } from '@/lib/icons'
import { setYoloEnabled } from '@/lib/yolo-session'
import { $yoloActive } from '@/store/session'

export const YOLO_PALETTE_CONTRIBUTIONS: readonly PaletteContribution[] = [
  paletteToggle({
    id: 'session.yolo',
    label: 'Toggle yolo',
    icon: Zap,
    keywords: ['yolo', 'approvals', 'auto-approve', 'bypass', 'dangerous', 'commands'],
    get: () => $yoloActive.get(),
    set: enabled => void setYoloEnabled(enabled).catch(() => undefined)
  }).data
]
