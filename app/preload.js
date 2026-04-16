const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dictation', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  health: () => ipcRenderer.invoke('worker:health'),
  devices: () => ipcRenderer.invoke('worker:devices'),
  deviceLevels: () => ipcRenderer.invoke('worker:deviceLevels'),
  models: () => ipcRenderer.invoke('worker:models'),
  downloadModel: (payload) => ipcRenderer.invoke('worker:downloadModel', payload),
  deleteModel: (payload) => ipcRenderer.invoke('worker:deleteModel', payload),
  gpuStatus: () => ipcRenderer.invoke('system:gpuStatus'),
  configure: (settings) => ipcRenderer.invoke('worker:configure', settings),
  startRecording: (payload) => ipcRenderer.invoke('record:start', payload),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),
  paste: (text) => ipcRenderer.invoke('clipboard:paste', text),
  onTrayRecord: (callback) => ipcRenderer.on('tray-record', callback),
  onTrayStop: (callback) => ipcRenderer.on('tray-stop', callback),
  onWorkerExit: (callback) => ipcRenderer.on('worker-exit', (_event, code) => callback(code))
});
