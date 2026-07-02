const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pwBridge', {
  submit: (value) => ipcRenderer.invoke('pw:submit', value),
})
