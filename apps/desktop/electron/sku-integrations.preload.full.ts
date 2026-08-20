import type { IpcRenderer } from 'electron'

export function createSkuPreloadBridge(ipcRenderer: IpcRenderer) {
  return {
    orgoDesktop: {
      getConfig: profile => ipcRenderer.invoke('hermes:orgo-desktop:config:get', profile),
      saveConfig: payload => ipcRenderer.invoke('hermes:orgo-desktop:config:save', payload),
      getSession: profile => ipcRenderer.invoke('hermes:orgo-desktop:session', profile),
      saveKey: key => ipcRenderer.invoke('hermes:orgo-desktop:key:save', key),
      status: () => ipcRenderer.invoke('hermes:orgo-desktop:status'),
      provision: () => ipcRenderer.invoke('hermes:orgo-desktop:provision'),
      ensureRunning: () => ipcRenderer.invoke('hermes:orgo-desktop:ensure-running'),
      doctor: () => ipcRenderer.invoke('hermes:orgo-desktop:doctor'),
      syncProfiles: profiles => ipcRenderer.invoke('hermes:orgo-desktop:sync', profiles),
      listWorkspaces: () => ipcRenderer.invoke('hermes:orgo-desktop:workspaces'),
      listComputers: workspaceId => ipcRenderer.invoke('hermes:orgo-desktop:computers', workspaceId),
      tailscaleLocalStatus: () => ipcRenderer.invoke('hermes:orgo-desktop:tailscale:local-status'),
      openTailscale: () => ipcRenderer.invoke('hermes:orgo-desktop:tailscale:local-open'),
      beginTailscale: () => ipcRenderer.invoke('hermes:orgo-desktop:tailscale:begin'),
      tailscaleStatus: () => ipcRenderer.invoke('hermes:orgo-desktop:tailscale:status'),
      connectRemoteHermes: () => ipcRenderer.invoke('hermes:orgo-desktop:tailscale:connect')
    },
    connectors: {
      keyStatus: () => ipcRenderer.invoke('hermes:connectors:key:status'),
      saveKey: key => ipcRenderer.invoke('hermes:connectors:key:save', key),
      removeKey: () => ipcRenderer.invoke('hermes:connectors:key:remove'),
      catalog: query => ipcRenderer.invoke('hermes:connectors:catalog', query),
      categories: () => ipcRenderer.invoke('hermes:connectors:categories'),
      connections: () => ipcRenderer.invoke('hermes:connectors:connections'),
      authorize: slug => ipcRenderer.invoke('hermes:connectors:authorize', slug),
      poll: slug => ipcRenderer.invoke('hermes:connectors:poll', slug),
      disconnect: slug => ipcRenderer.invoke('hermes:connectors:disconnect', slug),
      syncProfiles: profiles => ipcRenderer.invoke('hermes:connectors:sync', profiles)
    },
    probeConnectionConfig: remoteUrl => ipcRenderer.invoke('hermes:connection-config:probe', remoteUrl),
    oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('hermes:connection-config:oauth-login', remoteUrl),
    oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('hermes:connection-config:oauth-logout', remoteUrl),
    cloud: {
      status: () => ipcRenderer.invoke('hermes:cloud:status'),
      login: () => ipcRenderer.invoke('hermes:cloud:login'),
      logout: () => ipcRenderer.invoke('hermes:cloud:logout'),
      discover: org => ipcRenderer.invoke('hermes:cloud:discover', org),
      agentSignIn: dashboardUrl => ipcRenderer.invoke('hermes:cloud:agent-sign-in', dashboardUrl)
    },
    fetchLinkTitle: url => ipcRenderer.invoke('hermes:fetchLinkTitle', url),
    onOpenUpdatesRequested: callback => {
      const listener = () => callback()
      ipcRenderer.on('hermes:open-updates', listener)
      return () => ipcRenderer.removeListener('hermes:open-updates', listener)
    },
    getBootstrapState: () => ipcRenderer.invoke('hermes:bootstrap:get'),
    continueBootstrapLocal: () => ipcRenderer.invoke('hermes:bootstrap:continue-local'),
    resetBootstrap: () => ipcRenderer.invoke('hermes:bootstrap:reset'),
    repairBootstrap: () => ipcRenderer.invoke('hermes:bootstrap:repair'),
    cancelBootstrap: () => ipcRenderer.invoke('hermes:bootstrap:cancel'),
    onBootstrapEvent: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('hermes:bootstrap:event', listener)
      return () => ipcRenderer.removeListener('hermes:bootstrap:event', listener)
    },
    getRemoteDisplayReason: () => ipcRenderer.invoke('hermes:get-remote-display-reason'),
    uninstall: {
      summary: () => ipcRenderer.invoke('hermes:uninstall:summary'),
      run: mode => ipcRenderer.invoke('hermes:uninstall:run', { mode })
    },
    updates: {
      check: () => ipcRenderer.invoke('hermes:updates:check'),
      apply: opts => ipcRenderer.invoke('hermes:updates:apply', opts),
      getBranch: () => ipcRenderer.invoke('hermes:updates:branch:get'),
      setBranch: name => ipcRenderer.invoke('hermes:updates:branch:set', name),
      onProgress: callback => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('hermes:updates:progress', listener)
        return () => ipcRenderer.removeListener('hermes:updates:progress', listener)
      }
    }
  }
}
