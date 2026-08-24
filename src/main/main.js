'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { buildMenu } = require('./menu');
const { signWithP12, verifySignatures } = require('./signing');

const isDev = process.env.NODE_ENV === 'development';

// Fully offline app: never let Electron/Chromium phone home for updates,
// spellcheck dictionaries, etc.
app.setPath('crashDumps', path.join(app.getPath('temp'), 'pdf-editor-crashdumps'));
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(buildMenu(mainWindow));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

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

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

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
