export function createJourneySlashActionHandler(openMemoryGraph: () => void) {
  return async (): Promise<void> => {
    openMemoryGraph()
  }
}
