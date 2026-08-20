import type { IpcRenderer } from 'electron'

export function createSkuPreloadBridge(ipcRenderer: IpcRenderer) {
  return {
    gatewayProxy: {
      start: async request => {
        await ipcRenderer.invoke('hermes:gateway-proxy:start', request)
      },
      send: (id, data) => ipcRenderer.send('hermes:gateway-proxy:send', { data, id }),
      close: id => ipcRenderer.send('hermes:gateway-proxy:close', { id }),
      onEvent: callback => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('hermes:gateway-proxy:event', listener)

        return () => ipcRenderer.removeListener('hermes:gateway-proxy:event', listener)
      }
    }
  }
}
