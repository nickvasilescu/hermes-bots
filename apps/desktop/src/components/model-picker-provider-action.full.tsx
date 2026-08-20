import { useI18n } from '@/i18n'
import { startManualOnboarding } from '@/store/onboarding'

import { Button } from './ui/button'

export function ModelPickerProviderAction({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()

  return (
    <Button
      onClick={() => {
        startManualOnboarding()
        onOpenChange(false)
      }}
      variant="ghost"
    >
      {t.modelPicker.addProvider}
    </Button>
  )
}
