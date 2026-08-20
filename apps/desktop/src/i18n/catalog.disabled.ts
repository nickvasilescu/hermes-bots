import { en } from '@desktop/i18n-ssh-english'

import type { Locale, Translations } from './types'

// The constrained experiment deliberately ships one scrubbed catalog. This
// avoids retaining credential-entry copy from any locale while preserving the
// complete translation shape expected by the renderer.
export const TRANSLATIONS: Record<Locale, Translations> = {
  en,
  zh: en,
  'zh-hant': en,
  ja: en,
  ar: en
}
