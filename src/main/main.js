'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { signWithP12, verifySignatures } = require('./signing');
const { fetchGoogleFont } = require('./googleFonts');

const isDev = process.env.NODE_ENV === 'development';

// Fully offline app: never let Electron/Chromium phone home for updates,
// spellcheck dictionaries, etc.
app.setPath('crashDumps', path.join(app.getPath('temp'), 'paperlight-crashdumps'));
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;
// Mirrors the renderer's "any document has unsaved edits" state, so the
// close handler below only interrupts when there is something to lose.
let hasUnsavedChanges = false;
// Set once the user has confirmed, so the second close attempt goes
// through instead of prompting again.
let forceClosing = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Paperlight',
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0f0e14',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    // Frameless: the renderer draws its own title bar (icon, document tabs,
    // minimize/maximize/close) to match the design. Resizing from the
    // window edges still works automatically - Electron/Chromium provide
    // that for frame:false windows on Windows without extra code.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  // No native menu: frame:false hides it anyway, and Electron's menu
  // accelerators (Ctrl+O, Ctrl+S, ...) turn out not to reliably fire once
  // the bar itself is hidden (confirmed empirically, not assumed) - so
  // MenuBar.jsx draws the visible menu and App.jsx's own keydown listener
  // is the accelerator source instead. Explicit null also avoids Windows'
  // Alt-key menu-reveal quirk that can otherwise linger on a frameless
  // window with a menu still technically set.
  Menu.setApplicationMenu(null);

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizedChange', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizedChange', false));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Never let the window take unsaved edits down with it. Any close route
  // - the title bar's X, Alt+F4, the taskbar - lands here first; the
  // renderer owns the actual prompt (it knows the documents) and calls
  // back through 'window:forceClose' once the user has decided.
  mainWindow.on('close', (e) => {
    if (!hasUnsavedChanges || forceClosing) return;
    e.preventDefault();
    mainWindow.webContents.send('window:closeRequested');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open PDFs dropped/double-clicked from the OS onto the app icon (Windows
  // passes the path in argv; handled again in second-instance below).
  mainWindow.webContents.on('did-finish-load', () => {
    const argPath = process.argv.find((a) => a.toLowerCase().endsWith('.pdf'));
    if (argPath) openPathInRenderer(argPath);
  });
}

async function openPathInRenderer(filePath) {
  try {
    const data = await fs.readFile(filePath);
    if (mainWindow) {
      mainWindow.webContents.send('file:openedExternally', {
        name: path.basename(filePath),
        path: filePath,
        data: new Uint8Array(data)
      });
    }
  } catch (err) {
    // ignore - file may not exist / not be readable
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const argPath = argv.find((a) => a.toLowerCase().endsWith('.pdf'));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (argPath) openPathInRenderer(argPath);
    }
  });

  app.whenReady().then(() => {
    // Only 'local-fonts' is ever granted (used for the "System Fonts..."
    // picker so users can embed a font already installed on their PC).
    // Everything else (camera, mic, geolocation, notifications, ...) stays
    // denied - this app has no use for them and it keeps the offline/
    // privacy posture honest.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'local-fonts');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');

    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// ---------------------------------------------------------------------------
// IPC: custom title bar window controls (frame:false has no native ones)
// ---------------------------------------------------------------------------

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximizeToggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:forceClose', () => {
  forceClosing = true;
  mainWindow?.close();
});
ipcMain.handle('window:setHasUnsavedChanges', (_evt, value) => {
  hasUnsavedChanges = !!value;
});
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());

// ---------------------------------------------------------------------------
// IPC: file dialogs & filesystem
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:openPdfs', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
  });
  if (result.canceled) return [];
  const files = [];
  for (const filePath of result.filePaths) {
    const data = await fs.readFile(filePath);
    files.push({ name: path.basename(filePath), path: filePath, data: new Uint8Array(data) });
  }
  return files;
});

ipcMain.handle('dialog:openSingle', async (_evt, { title, extensions }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Open File',
    properties: ['openFile'],
    filters: [{ name: 'Files', extensions: extensions || ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath);
  return { name: path.basename(filePath), path: filePath, data: new Uint8Array(data) };
});

ipcMain.handle('dialog:saveAs', async (_evt, { defaultName, data, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF',
    defaultPath: defaultName || 'document.pdf',
    filters: filters || [{ name: 'PDF Documents', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return result.filePath;
});

ipcMain.handle('fs:writeToPath', async (_evt, { filePath, data }) => {
  await fs.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('fs:readPath', async (_evt, filePath) => {
  const data = await fs.readFile(filePath);
  return { name: path.basename(filePath), path: filePath, data: new Uint8Array(data) };
});

ipcMain.handle('dialog:pickExportFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Export Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:writeManyToFolder', async (_evt, { folder, files }) => {
  const written = [];
  for (const f of files) {
    const target = path.join(folder, f.name);
    await fs.writeFile(target, Buffer.from(f.data));
    written.push(target);
  }
  return written;
});

// ---------------------------------------------------------------------------
// IPC: digital signatures
// ---------------------------------------------------------------------------

ipcMain.handle('sign:digital', async (_evt, { pdfBytes, p12Bytes, password, meta }) => {
  try {
    const signed = await signWithP12(pdfBytes, p12Bytes, password, meta);
    return { ok: true, data: signed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sign:verify', async (_evt, pdfBytes) => {
  try {
    return { ok: true, signatures: verifySignatures(pdfBytes) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:getVersion', () => app.getVersion());

// Copying selected page text goes through Electron's clipboard rather than
// navigator.clipboard: the web API is permission-gated and rejects
// silently when the document isn't focused, which is exactly the moment a
// user hits Ctrl+C after dragging a selection across the canvas.
ipcMain.handle('clipboard:writeText', (_evt, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.handle('fonts:fetchGoogleFont', async (_evt, { family, bold, italic }) => {
  try {
    const data = await fetchGoogleFont(family, { bold, italic });
    return { ok: true, data, family };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
