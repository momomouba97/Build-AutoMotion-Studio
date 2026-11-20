'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const listen = (ch, cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('ams', {
  config: () => invoke('app:config'),
  encoders: () => invoke('app:encoders'),
  importMedia: (kind) => invoke('media:import', kind),
  requestThumbs: (items) => invoke('media:thumbs', items),
  requestProxies: (items) => invoke('media:proxies', items),
  analyzeAudio: (item) => invoke('audio:analyze', item),
  chooseExportPath: (name, ext) => invoke('export:choosePath', name, ext),
  startExport: (payload) => invoke('export:start', payload),
  cancelExport: () => invoke('export:cancel'),
  reveal: (p) => invoke('app:reveal', p),
  saveProject: (text, filePath, suggested) => invoke('project:save', text, filePath, suggested),
  openProject: () => invoke('project:open'),
  clearCache: () => invoke('cache:clear'),
  on: listen,
});
