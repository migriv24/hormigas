const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('newdb', {
  appVersion: require('../package.json').version,
  submit:        (data) => ipcRenderer.invoke('new-db:submit', data),
  pickCredsFile: ()     => ipcRenderer.invoke('new-db:pick-creds-file'),
  cancel:        ()     => ipcRenderer.invoke('new-db:cancel'),
})
