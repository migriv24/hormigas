const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('landing', {
  appVersion: require('../package.json').version,

  openFile:        ()              => ipcRenderer.invoke('landing:open-file'),
  loadWithPassword:(filePath, pw)  => ipcRenderer.invoke('landing:load-with-password', filePath, pw),
  openRecent:      (filePath)      => ipcRenderer.invoke('landing:open-recent', filePath),
  getRecent:       ()              => ipcRenderer.invoke('landing:get-recent'),
  newDatabase:     ()              => ipcRenderer.invoke('landing:new-database'),

  onStatus: (cb) => ipcRenderer.on('landing:status', (_, msg) => cb(msg)),
})
