import type { IpcRenderer } from 'electron'

export function createSkuHostToolsPreloadBridge(_ipcRenderer: IpcRenderer) {
  // The dedicated SSH identity is readable by trusted main/OpenSSH inside the
  // service namespace. Exposing any renderer file/PTY bridge would therefore
  // turn renderer compromise into private-key disclosure.
  return {}
}
