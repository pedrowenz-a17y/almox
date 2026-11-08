const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('almoxSetup', {
  status: () => ipcRenderer.invoke('almox:status'),
  connect: origin => ipcRenderer.invoke('almox:connect', origin),
  importLocal: () => ipcRenderer.invoke('almox:import-local'),
});
