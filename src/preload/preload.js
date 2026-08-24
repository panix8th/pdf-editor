'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Minimal, explicit bridge between the sandboxed renderer and the main
 * process. No Node globals are exposed to the page - only these functions.
 */
contextBridge.exposeInMainWorld('pdfEditor', {
  openPdfDialog: () => ipcRenderer.invoke('dialog:openPdfs'),
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openSingle', opts || {}),
  saveAs: (defaultName, data, filters) => ipcRenderer.invoke('dialog:saveAs', { defaultName, data, filters }),
  writeToPath: (filePath, data) => ipcRenderer.invoke('fs:writeToPath', { filePath, data }),
  readPath: (filePath) => ipcRenderer.invoke('fs:readPath', filePath),
  pickExportFolder: () => ipcRenderer.invoke('dialog:pickExportFolder'),
  writeManyToFolder: (folder, files) => ipcRenderer.invoke('fs:writeManyToFolder', { folder, files }),

  signDigital: (pdfBytes, p12Bytes, password, meta) =>
    ipcRenderer.invoke('sign:digital', { pdfBytes, p12Bytes, password, meta }),
  verifySignatures: (pdfBytes) => ipcRenderer.invoke('sign:verify', pdfBytes),

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Resolve a native filesystem path for a File dragged from the OS, so we
  // can read it (and files referenced relative to it) via IPC.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onMenuAction: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  onFileOpenedExternally: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('file:openedExternally', listener);
    return () => ipcRenderer.removeListener('file:openedExternally', listener);
  }
});
