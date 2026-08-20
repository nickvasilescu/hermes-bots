import { atom } from 'nanostores'

const AUTO_SPEAK_KEY = 'korgo.ssh.auto-speak'

const readAutoSpeak = (): boolean => {
  try {
    return window.localStorage.getItem(AUTO_SPEAK_KEY) === 'true'
  } catch {
    return false
  }
}

export const $autoSpeakReplies = atom<boolean>(typeof window === 'undefined' ? false : readAutoSpeak())

export function applyAutoSpeakFromConfig(_config: unknown) {}

export const $voiceStopPhrase = atom<string | null>('stop')

export function applyVoiceStopPhraseFromConfig(
  config: { voice?: { stop_phrases?: unknown } | null } | null | undefined
) {
  const raw = config?.voice?.stop_phrases

  if (raw === undefined) {
    $voiceStopPhrase.set('stop')

    return
  }

  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const first = list.map(entry => String(entry).trim()).find(entry => entry.length > 0)

  $voiceStopPhrase.set(first ?? null)
}

export const $thinkingSoundEnabled = atom<boolean>(true)

export function applyThinkingSoundFromConfig(
  config: { voice?: { thinking_sound?: unknown } | null } | null | undefined
) {
  $thinkingSoundEnabled.set(config?.voice?.thinking_sound !== false)
}

export async function setAutoSpeakReplies(enabled: boolean): Promise<void> {
  $autoSpeakReplies.set(enabled)

  try {
    window.localStorage.setItem(AUTO_SPEAK_KEY, String(enabled))
  } catch {
    // The in-memory preference still works when persistence is unavailable.
  }
}
