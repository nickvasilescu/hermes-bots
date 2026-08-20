export interface NativeTokenStoreIo {
  encrypt: (plaintext: string) => unknown
  decrypt: (secret: unknown) => string
  readStoreText: () => string
  writeStoreText: (text: string) => void
  rememberLog?: (message: string) => void
}

export const loadNativeTokenSet = undefined as never
export const persistNativeTokenSet = undefined as never
