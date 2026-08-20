import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { requestProfileCreate } from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'

export function ProfileManagementActions() {
  const { t } = useI18n()

  return (
    <>
      <DropdownMenuItem onSelect={requestProfileCreate}>{t.profiles.newProfile}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void runImportProfileFlow()}>{t.profiles.importProfile}</DropdownMenuItem>
    </>
  )
}
