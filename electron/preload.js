const { contextBridge, ipcRenderer } = require('electron')

const _versionArg = process.argv.find(a => a.startsWith('--app-version='))
const _appVersion = _versionArg
  ? _versionArg.split('=')[1]
  : (process.env.npm_package_version || require('../package.json').version)

contextBridge.exposeInMainWorld('hormiga', {
  platform:   process.platform,
  appVersion: _appVersion,
  variant:    'stable',

  versions: {
    electron: process.versions.electron,
    node:     process.versions.node,
    chrome:   process.versions.chrome,
  },

  exportMiga:     ()              => ipcRenderer.invoke('main:export-miga'),
  getAutoOpen:    ()              => ipcRenderer.invoke('main:get-auto-open'),
  setAutoOpen:    (value)         => ipcRenderer.invoke('main:set-auto-open', value),

  showOpenDialog: (opts)          => ipcRenderer.invoke('dialog:open-file', opts),
  showSaveDialog: (opts)          => ipcRenderer.invoke('dialog:save-file', opts),
  readTextFile:   (filePath)      => ipcRenderer.invoke('file:read-text', filePath),
  writeTextFile:  (filePath, txt) => ipcRenderer.invoke('file:write-text', filePath, txt),
})
