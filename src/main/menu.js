const { Menu, shell } = require('electron');

/**
 * Builds the application menu. Every actionable item forwards a
 * `menu:action` IPC event to the focused renderer instead of doing work
 * here directly - all document/editing logic lives in the renderer store.
 */
function send(win, action, payload) {
  return () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu:action', { action, payload });
    }
  };
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open PDF...', accelerator: 'CmdOrCtrl+O', click: send(win, 'file:open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send(win, 'file:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: send(win, 'file:saveAs') },
        { type: 'separator' },
        { label: 'Merge PDFs...', click: send(win, 'file:merge') },
        { label: 'Split PDF...', click: send(win, 'file:split') },
        { label: 'Export Pages as Images...', click: send(win, 'file:exportImages') },
        { type: 'separator' },
        { label: 'Set / Remove Password...', click: send(win, 'file:password') },
        { type: 'separator' },
        { label: 'Close Document', accelerator: 'CmdOrCtrl+W', click: send(win, 'file:close') },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send(win, 'edit:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send(win, 'edit:redo') },
        { type: 'separator' },
        { label: 'Delete Selected', accelerator: 'Delete', click: send(win, 'edit:deleteSelected') },
        { type: 'separator' },
        { label: 'Find...', accelerator: 'CmdOrCtrl+F', click: send(win, 'edit:find') }
      ]
    },
    {
      label: 'Annotate',
      submenu: [
        { label: 'Add Text Box', accelerator: 'CmdOrCtrl+T', click: send(win, 'tool:text') },
        { label: 'Insert Image', click: send(win, 'tool:image') },
        { label: 'Highlight', click: send(win, 'tool:highlight') },
        { label: 'Rectangle', click: send(win, 'tool:rect') },
        { label: 'Line', click: send(win, 'tool:line') },
        { label: 'Arrow', click: send(win, 'tool:arrow') },
        { label: 'Freehand Pen', click: send(win, 'tool:pen') },
        { label: 'Redact', click: send(win, 'tool:redact') },
        { type: 'separator' },
        { label: 'Fill Form Fields', click: send(win, 'tool:form') }
      ]
    },
    {
      label: 'Sign',
      submenu: [
        { label: 'Add Visual Signature...', click: send(win, 'sign:visual') },
        { label: 'Add Digital Signature...', click: send(win, 'sign:digital') },
        { label: 'Verify Signatures', click: send(win, 'sign:verify') }
      ]
    },
    {
      label: 'Page',
      submenu: [
        { label: 'Insert Blank Page', click: send(win, 'page:insertBlank') },
        { label: 'Insert PDF Pages...', click: send(win, 'page:insertFromFile') },
        { label: 'Delete Page', click: send(win, 'page:delete') },
        { label: 'Duplicate Page', click: send(win, 'page:duplicate') },
        { label: 'Rotate Left', click: send(win, 'page:rotateLeft') },
        { label: 'Rotate Right', click: send(win, 'page:rotateRight') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send(win, 'view:zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send(win, 'view:zoomOut') },
        { label: 'Fit Width', click: send(win, 'view:fitWidth') },
        { label: 'Fit Page', click: send(win, 'view:fitPage') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send(win, 'view:toggleSidebar') },
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+J', click: send(win, 'view:toggleTheme') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PDF Editor',
          click: send(win, 'help:about')
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
