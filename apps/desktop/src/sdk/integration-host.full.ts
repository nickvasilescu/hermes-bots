import { openConnectors } from '@/app/connectors/store'

/** Full-product plugin doors. Kept behind a Vite alias so constrained SKUs
 * never pull their native bridge namespaces into the renderer graph. */
export const integrationHost = {
  connectors: {
    open: () => openConnectors(),
    syncProfiles: async (profiles: string[]) => {
      const api = window.hermesDesktop?.connectors

      if (!api?.syncProfiles) {
        return { synced: 0, removed: 0, toolkits: [] as string[] }
      }

      return api.syncProfiles(profiles)
    }
  },
  orgo: {
    syncProfiles: async (profiles: string[]) => {
      const api = window.hermesDesktop?.orgoDesktop

      if (!api?.syncProfiles) {
        return { synced: 0, computerId: '' }
      }

      return api.syncProfiles(profiles)
    }
  }
}
