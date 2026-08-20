import { contextBridge, ipcRenderer } from 'electron'

import { createSkuHostToolsPreloadBridge } from './sku-integrations.host-tools.preload'
import { createSkuPreloadBridge } from './sku-integrations.preload'

contextBridge.exposeInMainWorld('hermesDesktop', {
  getConnection: profile => ipcRenderer.invoke('hermes:connection', profile),
  revalidateConnection: () => ipcRenderer.invoke('hermes:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('hermes:backend:touch', profile),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('hermes:window:openSession', sessionId, opts),
  openWindow: () => ipcRenderer.invoke('hermes:window:openInstance'),
  claimAmbientCue: key => ipcRenderer.invoke('hermes:ambient:claim', key),
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('hermes:wake-indicator:get'),
    setState: state => ipcRenderer.send('hermes:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('hermes:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('hermes:wake-indicator:state', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    open: request => ipcRenderer.invoke('hermes:hud:open', request),
    close: () => ipcRenderer.invoke('hermes:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('hermes:hud:ignore-mouse', ignore),
    moveBy: delta => ipcRenderer.send('hermes:hud:move-by', delta),
    setBounds: bounds => ipcRenderer.send('hermes:hud:set-bounds', bounds),
    setVibrancy: on => ipcRenderer.invoke('hermes:hud:vibrancy', on),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('hermes:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('hermes:hud:goto', listener)

      return () => ipcRenderer.removeListener('hermes:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('hermes:hud:changed', listener)

      return () => ipcRenderer.removeListener('hermes:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('hermes:hud:cursor', listener)

      return () => ipcRenderer.removeListener('hermes:hud:cursor', listener)
    }
  },
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('hermes:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('hermes:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('hermes:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('hermes:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('hermes:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('hermes:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('hermes:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('hermes:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('hermes:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('hermes:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('hermes:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('hermes:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('hermes:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:test', payload),
  profile: {
    get: () => ipcRenderer.invoke('hermes:profile:get'),
    set: name => ipcRenderer.invoke('hermes:profile:set', name)
  },
  api: request => ipcRenderer.invoke('hermes:api', request),
  notify: payload => ipcRenderer.invoke('hermes:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('hermes:requestMicrophoneAccess'),
  ...createSkuHostToolsPreloadBridge(ipcRenderer),
  setActiveWork: payload => ipcRenderer.send('hermes:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('hermes:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('hermes:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('hermes:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('hermes:keep-awake', on),
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('hermes:zoom:get'),
    setPercent: percent => ipcRenderer.send('hermes:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('hermes:zoom:changed', listener)

      return () => ipcRenderer.removeListener('hermes:zoom:changed', listener)
    }
  },
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('hermes:logs:renderer-error', report),
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:deep-link', listener)

    return () => ipcRenderer.removeListener('hermes:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('hermes:deep-link-ready'),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:window-state-changed', listener)

    return () => ipcRenderer.removeListener('hermes:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('hermes:focus-session', listener)

    return () => ipcRenderer.removeListener('hermes:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:notification-action', listener)

    return () => ipcRenderer.removeListener('hermes:notification-action', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:backend-exit', listener)

    return () => ipcRenderer.removeListener('hermes:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('hermes:connection:applied', listener)

    return () => ipcRenderer.removeListener('hermes:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('hermes:power-resume', listener)

    return () => ipcRenderer.removeListener('hermes:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('hermes:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('hermes:power-battery', listener)

    return () => ipcRenderer.removeListener('hermes:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:boot-progress', listener)

    return () => ipcRenderer.removeListener('hermes:boot-progress', listener)
  },
  getVersion: () => ipcRenderer.invoke('hermes:version'),
  ...createSkuPreloadBridge(ipcRenderer),
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('hermes:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('hermes:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('hermes:found-in-page', listener)

    return () => ipcRenderer.removeListener('hermes:found-in-page', listener)
  }
})
