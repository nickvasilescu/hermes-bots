import type { PaletteContribution } from '@/app/command-palette/contrib'
import { Download, Upload } from '@/lib/icons'
import { runExportProfileFlow, runImportProfileFlow } from '@/store/profile-share'

export const PROFILE_TRANSFER_CONTRIBUTIONS: readonly PaletteContribution[] = [
  {
    id: 'profile.export',
    label: 'Export profile…',
    icon: Upload,
    keywords: ['profile', 'export', 'share', 'bundle', 'theme', 'settings', 'backup'],
    run: () => void runExportProfileFlow()
  },
  {
    id: 'profile.import',
    label: 'Import profile…',
    icon: Download,
    keywords: ['profile', 'import', 'share', 'bundle', 'archive', 'restore'],
    run: () => void runImportProfileFlow()
  }
]
