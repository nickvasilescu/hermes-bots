import { translateNow } from '@/i18n'

export function summarizeProviderCredentialError(message: string): string | null {
  if (/incorrect api key provided/i.test(message) || /['"]code['"]\s*:\s*['"]invalid_api_key['"]/i.test(message)) {
    const status = message.match(/(?:error code|status(?:Code)?)[^\d]*(\d{3})/i)?.[1]

    return status
      ? translateNow('notifications.errors.openaiRejectedApiKeyWithStatus', status)
      : translateNow('notifications.errors.openaiRejectedApiKey')
  }

  if (/neither voice_tools_openai_key nor openai_api_key is set/i.test(message)) {
    return translateNow('notifications.errors.openaiTtsNeedsKey')
  }

  if (/ELEVENLABS_API_KEY not set/i.test(message) || /ElevenLabs STT API error \(HTTP 401\)/i.test(message)) {
    return /ELEVENLABS_API_KEY not set/i.test(message)
      ? translateNow('notifications.errors.elevenLabsNeedsKey')
      : translateNow('notifications.errors.elevenLabsRejectedKey')
  }

  return null
}
