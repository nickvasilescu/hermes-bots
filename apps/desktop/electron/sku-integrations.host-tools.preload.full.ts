import { type IpcRenderer, webUtils } from 'electron'

export function createSkuHostToolsPreloadBridge(ipcRenderer: IpcRenderer) {
  return {
    sshConfigHosts: () => ipcRenderer.invoke('hermes:ssh-config:hosts'),
    sshResolveHost: host => ipcRenderer.invoke('hermes:ssh-config:resolve', host),
    petOverlay: {
      open: request => ipcRenderer.invoke('hermes:pet-overlay:open', request),
      close: () => ipcRenderer.invoke('hermes:pet-overlay:close'),
      setBounds: bounds => ipcRenderer.send('hermes:pet-overlay:set-bounds', bounds),
      setIgnoreMouse: ignore => ipcRenderer.send('hermes:pet-overlay:ignore-mouse', ignore),
      setFocusable: focusable => ipcRenderer.send('hermes:pet-overlay:set-focusable', focusable),
      pushState: payload => ipcRenderer.send('hermes:pet-overlay:state', payload),
      control: payload => ipcRenderer.send('hermes:pet-overlay:control', payload),
      onState: callback => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('hermes:pet-overlay:state', listener)

        return () => ipcRenderer.removeListener('hermes:pet-overlay:state', listener)
      },
      onControl: callback => {
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on('hermes:pet-overlay:control', listener)

        return () => ipcRenderer.removeListener('hermes:pet-overlay:control', listener)
      }
    },
    readWindowBelow: () => ipcRenderer.invoke('hermes:window:readBelow'),
    readFileDataUrl: filePath => ipcRenderer.invoke('hermes:readFileDataUrl', filePath),
    readFileDataUrlForAttach: filePath => ipcRenderer.invoke('hermes:readFileDataUrlForAttach', filePath),
    dataUrlReadMax: {
      get: () => ipcRenderer.invoke('hermes:data-url-read-max:get'),
      set: maxMb => ipcRenderer.invoke('hermes:data-url-read-max:set', maxMb)
    },
    readFileText: filePath => ipcRenderer.invoke('hermes:readFileText', filePath),
    selectPaths: options => ipcRenderer.invoke('hermes:selectPaths', options),
    selectSavePath: options => ipcRenderer.invoke('hermes:selectSavePath', options),
    writeClipboard: text => ipcRenderer.invoke('hermes:writeClipboard', text),
    readClipboard: () => ipcRenderer.invoke('hermes:readClipboard'),
    saveImageFromUrl: url => ipcRenderer.invoke('hermes:saveImageFromUrl', url),
    saveImageBuffer: (data, ext) => ipcRenderer.invoke('hermes:saveImageBuffer', { data, ext }),
    saveClipboardImage: () => ipcRenderer.invoke('hermes:saveClipboardImage'),
    getPathForFile: file => {
      try {
        return webUtils.getPathForFile(file) || ''
      } catch {
        return ''
      }
    },
    normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('hermes:normalizePreviewTarget', target, baseDir),
    watchPreviewFile: url => ipcRenderer.invoke('hermes:watchPreviewFile', url),
    watchDirectory: dir => ipcRenderer.invoke('hermes:watchDirectory', dir),
    stopPreviewFileWatch: id => ipcRenderer.invoke('hermes:stopPreviewFileWatch', id),
    setPreviewShortcutActive: active => ipcRenderer.send('hermes:previewShortcutActive', Boolean(active)),
    openExternal: url => ipcRenderer.invoke('hermes:openExternal', url),
    openPreviewInBrowser: url => ipcRenderer.invoke('hermes:openPreviewInBrowser', url),
    sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('hermes:workspace:sanitize', cwd),
    settings: {
      getDefaultProjectDir: () => ipcRenderer.invoke('hermes:setting:defaultProjectDir:get'),
      setDefaultProjectDir: dir => ipcRenderer.invoke('hermes:setting:defaultProjectDir:set', dir),
      pickDefaultProjectDir: () => ipcRenderer.invoke('hermes:setting:defaultProjectDir:pick')
    },
    revealLogs: () => ipcRenderer.invoke('hermes:logs:reveal'),
    getRecentLogs: () => ipcRenderer.invoke('hermes:logs:recent'),
    readDir: dirPath => ipcRenderer.invoke('hermes:fs:readDir', dirPath),
    gitRoot: startPath => ipcRenderer.invoke('hermes:fs:gitRoot', startPath),
    revealPath: targetPath => ipcRenderer.invoke('hermes:fs:reveal', targetPath),
    openDir: dirPath => ipcRenderer.invoke('hermes:fs:openDir', dirPath),
    desktopPluginsRoot: () => ipcRenderer.invoke('hermes:fs:desktopPluginsRoot'),
    agentPluginsRoot: () => ipcRenderer.invoke('hermes:fs:agentPluginsRoot'),
    renamePath: (targetPath, newName) => ipcRenderer.invoke('hermes:fs:rename', targetPath, newName),
    writeTextFile: (filePath, content) => ipcRenderer.invoke('hermes:fs:writeText', filePath, content),
    trashPath: targetPath => ipcRenderer.invoke('hermes:fs:trash', targetPath),
    git: {
      worktreeList: repoPath => ipcRenderer.invoke('hermes:git:worktreeList', repoPath),
      worktreeAdd: (repoPath, options) => ipcRenderer.invoke('hermes:git:worktreeAdd', repoPath, options),
      worktreeRemove: (repoPath, worktreePath, options) =>
        ipcRenderer.invoke('hermes:git:worktreeRemove', repoPath, worktreePath, options),
      branchSwitch: (repoPath, branch) => ipcRenderer.invoke('hermes:git:branchSwitch', repoPath, branch),
      branchList: repoPath => ipcRenderer.invoke('hermes:git:branchList', repoPath),
      baseBranchList: repoPath => ipcRenderer.invoke('hermes:git:baseBranchList', repoPath),
      repoStatus: repoPath => ipcRenderer.invoke('hermes:git:repoStatus', repoPath),
      fileDiff: (repoPath, filePath) => ipcRenderer.invoke('hermes:git:fileDiff', repoPath, filePath),
      scanRepos: (roots, options) => ipcRenderer.invoke('hermes:git:scanRepos', roots, options),
      review: {
        list: (repoPath, scope, baseRef) => ipcRenderer.invoke('hermes:git:review:list', repoPath, scope, baseRef),
        diff: (repoPath, filePath, scope, baseRef, staged) =>
          ipcRenderer.invoke('hermes:git:review:diff', repoPath, filePath, scope, baseRef, staged),
        stage: (repoPath, filePath) => ipcRenderer.invoke('hermes:git:review:stage', repoPath, filePath),
        unstage: (repoPath, filePath) => ipcRenderer.invoke('hermes:git:review:unstage', repoPath, filePath),
        revert: (repoPath, filePath) => ipcRenderer.invoke('hermes:git:review:revert', repoPath, filePath),
        revParse: (repoPath, ref) => ipcRenderer.invoke('hermes:git:review:revParse', repoPath, ref),
        commit: (repoPath, message, push) => ipcRenderer.invoke('hermes:git:review:commit', repoPath, message, push),
        commitContext: repoPath => ipcRenderer.invoke('hermes:git:review:commitContext', repoPath),
        push: repoPath => ipcRenderer.invoke('hermes:git:review:push', repoPath),
        shipInfo: repoPath => ipcRenderer.invoke('hermes:git:review:shipInfo', repoPath),
        prList: (repoPath, branches, numbers) =>
          ipcRenderer.invoke('hermes:git:review:prList', repoPath, branches, numbers),
        fetchPrComment: (repoPath, url) => ipcRenderer.invoke('hermes:git:review:fetchPrComment', repoPath, url),
        createPr: repoPath => ipcRenderer.invoke('hermes:git:review:createPr', repoPath)
      }
    },
    terminal: {
      cwd: id => ipcRenderer.invoke('hermes:terminal:cwd', id),
      dispose: id => ipcRenderer.invoke('hermes:terminal:dispose', id),
      resize: (id, size) => ipcRenderer.invoke('hermes:terminal:resize', id, size),
      start: options => ipcRenderer.invoke('hermes:terminal:start', options),
      write: (id, data) => ipcRenderer.invoke('hermes:terminal:write', id, data),
      onData: (id, callback) => {
        const channel = `hermes:terminal:${id}:data`
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on(channel, listener)

        return () => ipcRenderer.removeListener(channel, listener)
      },
      onExit: (id, callback) => {
        const channel = `hermes:terminal:${id}:exit`
        const listener = (_event, payload) => callback(payload)
        ipcRenderer.on(channel, listener)

        return () => ipcRenderer.removeListener(channel, listener)
      }
    },
    onClosePreviewRequested: callback => {
      const listener = () => callback()
      ipcRenderer.on('hermes:close-preview-requested', listener)

      return () => ipcRenderer.removeListener('hermes:close-preview-requested', listener)
    },
    onOpenFolderRequested: callback => {
      const listener = () => callback()
      ipcRenderer.on('hermes:open-folder-requested', listener)

      return () => ipcRenderer.removeListener('hermes:open-folder-requested', listener)
    },
    onPreviewFileChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('hermes:preview-file-changed', listener)

      return () => ipcRenderer.removeListener('hermes:preview-file-changed', listener)
    }
  }
}
