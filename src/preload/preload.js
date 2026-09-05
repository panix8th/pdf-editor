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

  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  // Unsaved-changes guard: the renderer keeps main informed, main asks the
  // renderer to confirm before letting the window actually close.
  setHasUnsavedChanges: (value) => ipcRenderer.invoke('window:setHasUnsavedChanges', value),
  onWindowCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:closeRequested', listener);
    return () => ipcRenderer.removeListener('window:closeRequested', listener);
  },

  // Frame:false means the renderer draws its own title bar, so it needs
  // the window-management calls a native frame would normally provide.
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    // Close without the unsaved-changes prompt - called only after the
    // renderer has already asked the user.
    forceClose: () => ipcRenderer.invoke('window:forceClose'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (callback) => {
      const listener = (_evt, isMaximized) => callback(isMaximized);
      ipcRenderer.on('window:maximizedChange', listener);
      return () => ipcRenderer.removeListener('window:maximizedChange', listener);
    }
  },

  // The one deliberate exception to this app's offline-by-default design:
  // fetches a real font file from Google Fonts (main process only, never
  // exposed to the renderer's own network stack) so an edited run of
  // existing PDF text can keep looking like its original font.
  fetchGoogleFont: (family, bold, italic) => ipcRenderer.invoke('fonts:fetchGoogleFont', { family, bold, italic }),

  // Installed fonts, read off disk by the main process. This replaces
  // Chromium's queryLocalFonts(), which is permission-gated, needs a user
  // gesture, and returns nothing on many systems.
  fonts: {
    listSystem: (opts) => ipcRenderer.invoke('fonts:listSystem', opts || {}),
    loadFace: (fontPath, postscriptName) => ipcRenderer.invoke('fonts:loadFace', { path: fontPath, postscriptName }),
    // Downloads a missing font and hands it to the OS installer.
    downloadForInstall: (family, bold, italic) => ipcRenderer.invoke('fonts:downloadForInstall', { family, bold, italic }),
    // Opens the font's page in the default browser. Takes a family name,
    // not a URL - the main process builds the link itself.
    openSpecimen: (family) => ipcRenderer.invoke('fonts:openSpecimen', family)
  },

  // Resolve a native filesystem path for a File dragged from the OS, so we
  // can read it (and files referenced relative to it) via IPC.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onFileOpenedExternally: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('file:openedExternally', listener);
    return () => ipcRenderer.removeListener('file:openedExternally', listener);
  }
});
