export type PetChangeMeta = Record<string, unknown>

export const burstVibeHearts = (): void => undefined
export const notifyPetChanged = (_meta?: PetChangeMeta): void => undefined
export const flashPetActivity = (_patch: Record<string, unknown>, _durationMs?: number): void => undefined
export const markPetUnread = (): void => undefined
export const setPetActivity = (_patch: Record<string, unknown>): void => undefined
