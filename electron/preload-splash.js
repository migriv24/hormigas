const { contextBridge, ipcRenderer } = require('electron')

const _versionArg = process.argv.find(a => a.startsWith('--app-version='))
const _appVersion = _versionArg
  ? _versionArg.split('=')[1]
  : (process.env.npm_package_version || require('../package.json').version)

contextBridge.exposeInMainWorld('splash', {
  onMessage:      (cb) => ipcRenderer.on('splash-message',  (_, msg)  => cb(msg)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status',   (_, data) => cb(data)),
  appVersion:     _appVersion,
})
