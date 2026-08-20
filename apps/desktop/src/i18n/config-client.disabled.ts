import type { HermesConfigRecord } from '@/hermes'

const LOCALE_KEY = 'korgo.ssh.locale'

export interface DesktopI18nConfigClient {
  getConfig: () => Promise<HermesConfigRecord>
  saveConfig: (config: HermesConfigRecord) => Promise<{ ok: boolean }>
}

const readLocale = (): string | undefined => {
  try {
    return window.localStorage.getItem(LOCALE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export const DESKTOP_I18N_CONFIG_CLIENT: DesktopI18nConfigClient = {
  getConfig: async () => ({ display: { language: readLocale() } }),
  saveConfig: async config => {
    const display = config.display && typeof config.display === 'object' ? config.display : {}
    const language = (display as Record<string, unknown>).language

    try {
      if (typeof language === 'string' && language) {
        window.localStorage.setItem(LOCALE_KEY, language)
      } else {
        window.localStorage.removeItem(LOCALE_KEY)
      }

      return { ok: true }
    } catch {
      return { ok: false }
    }
  }
}
