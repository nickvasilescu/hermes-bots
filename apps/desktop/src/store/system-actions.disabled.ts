import { atom } from 'nanostores'

export const $gatewayRestarting = atom(false)

export async function runGatewayRestart(): Promise<void> {}
