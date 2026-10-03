'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  writeFile: (filePath, data) => ipcRenderer.invoke('file:write', filePath, data),
  readFile: (filePath, asText) => ipcRenderer.invoke('file:read', filePath, asText),
  showItem: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  exportStart: (opts) => ipcRenderer.invoke('export:start', opts),
  exportFrame: (frame) => ipcRenderer.invoke('export:frame', frame),
  exportFinish: () => ipcRenderer.invoke('export:finish'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  ffmpegCheck: () => ipcRenderer.invoke('ffmpeg:check'),
});
