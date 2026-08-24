import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useStore, getResource } from './state/store';
import { bakeDocument } from './pdf/documentIO';
import TitleBar from './components/TitleBar.jsx';
import MenuBar from './components/MenuBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Viewer from './components/Viewer.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import Dialogs from './components/Dialogs.jsx';
import { IconUpload } from './components/Icons.jsx';
import { getRecentFiles, removeRecentFile, formatRelativeTime } from './state/recentFiles';

async function fileToMeta(file) {
  const buf = await file.arrayBuffer();
  // Resolve the real filesystem path for a dragged-in file so it behaves
  // exactly like one opened via the dialog: Save (not just Save As) works,
  // and it can appear in the Recent list.
  let path = null;
  try {
    path = window.pdfEditor.getPathForFile(file) || null;
  } catch {
    /* not fatal - falls back to Save As-only, same as before this existed */
  }
  return { name: file.name, path, data: new Uint8Array(buf) };
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const order = useStore((s) => s.order);
  const documents = useStore((s) => s.documents);
  const activeId = useStore((s) => s.activeId);
  const toast = useStore((s) => s.toast);
  const dialog = useStore((s) => s.dialog);
  const closeDocument = useStore((s) => s.closeDocument);
  const openFile = useStore((s) => s.openFile);
  const openDialog = useStore((s) => s.openDialog);
  const showToast = useStore((s) => s.showToast);
  const clearToast = useStore((s) => s.clearToast);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const setTool = useStore((s) => s.setTool);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setZoom = useStore((s) => s.setZoom);
  const setFitMode = useStore((s) => s.setFitMode);
  const updateDoc = useStore((s) => s.updateDoc);

  const accent = useStore((s) => s.accent);
  const [dragging, setDragging] = useState(false);
  const [recentFiles, setRecentFiles] = useState(() => getRecentFiles());
  const activeDoc = documents[activeId] || null;

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.body.dataset.accent = accent;
  }, [accent]);

  // Refresh the Recent list whenever a document opens (a fresh open, or
  // the reorder that happens when re-opening an existing recent entry).
  useEffect(() => {
    if (!activeDoc) setRecentFiles(getRecentFiles());
  }, [order.length, activeDoc]);

  const openRecent = useCallback(
    async (path) => {
      try {
        const fileMeta = await window.pdfEditor.readPath(path);
        await openFile(fileMeta);
      } catch {
        showToast('error', 'Could not open that file - it may have moved or been deleted.');
        removeRecentFile(path);
        setRecentFiles(getRecentFiles());
      }
    },
    [openFile, showToast]
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4200);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  const handleOpenDialog = useCallback(async () => {
    const files = await window.pdfEditor.openPdfDialog();
    for (const f of files) await openFile(f);
  }, [openFile]);

  const doSave = useCallback(
    async (forcePathPicker) => {
      const doc = useStore.getState().documents[useStore.getState().activeId];
      if (!doc) return;
      if (doc.isEncrypted && doc.editingUnsupported) {
        showToast('error', 'This PDF’s encryption type is not supported for saving edits.');
        return;
      }
      try {
        const resources = getResource(doc.id);
        const bytes = await bakeDocument({ docState: doc, resources, formValues: doc.formValues });
        if (!forcePathPicker && doc.filePath) {
          await window.pdfEditor.writeToPath(doc.filePath, bytes);
          updateDoc(doc.id, { dirty: false, fileSize: bytes.length });
          showToast('info', `Saved to ${doc.filePath}`);
        } else {
          const savedPath = await window.pdfEditor.saveAs(doc.name, bytes);
          if (savedPath) {
            updateDoc(doc.id, { dirty: false, filePath: savedPath, name: savedPath.split(/[\\/]/).pop(), fileSize: bytes.length });
            showToast('info', `Saved to ${savedPath}`);
          }
        }
      } catch (err) {
        showToast('error', `Save failed: ${err.message}`);
      }
    },
    [showToast, updateDoc]
  );

  // ---- menu actions -----------------------------------------------------
  // Shared by the native accelerators (forwarded from main via IPC - see
  // menu.js, whose click handlers still fire even though frame:false hides
  // the native menu bar those accelerators would otherwise live in) and the
  // custom-styled MenuBar the renderer draws in its place, so both paths
  // run identical logic.
  const runMenuAction = useCallback(
    (action) => {
      const s = useStore.getState();
      const doc = s.documents[s.activeId];
      switch (action) {
        case 'file:open':
          handleOpenDialog();
          break;
        case 'file:save':
          doSave(false);
          break;
        case 'file:saveAs':
          doSave(true);
          break;
        case 'file:merge':
          openDialog('merge');
          break;
        case 'file:split':
          if (doc) openDialog('split');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'file:exportImages':
          if (doc) openDialog('exportImages');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'file:password':
          if (doc) openDialog('protect');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'file:close':
          if (doc) closeDocument(doc.id);
          break;
        case 'edit:undo':
          if (doc) undo(doc.id);
          break;
        case 'edit:redo':
          if (doc) redo(doc.id);
          break;
        case 'edit:deleteSelected': {
          const active = document.activeElement;
          const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
          if (doc && !typing) deleteSelected(doc.id);
          break;
        }
        case 'edit:find':
          if (doc) s.setSidebarTab('search');
          break;
        case 'tool:image':
          if (doc) s.insertImage(doc.id);
          break;
        case 'tool:text':
        case 'tool:highlight':
        case 'tool:rect':
        case 'tool:ellipse':
        case 'tool:line':
        case 'tool:arrow':
        case 'tool:pen':
        case 'tool:redact':
          if (doc) setTool(doc.id, action.split(':')[1]);
          break;
        case 'tool:form':
          if (doc) s.setSidebarTab('forms');
          break;
        case 'sign:visual':
          if (doc) openDialog('visualSignature');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'sign:digital':
          if (doc) openDialog('digitalSignature');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'sign:verify':
          if (doc) openDialog('verifySignatures');
          else showToast('error', 'Open a PDF first.');
          break;
        case 'page:insertBlank':
          if (doc) s.insertBlankPage(doc.id, doc.currentPage - 1);
          break;
        case 'page:insertFromFile':
          if (doc) openDialog('insertPages');
          break;
        case 'page:delete':
          if (doc && doc.selection === null) {
            const key = doc.pages[doc.currentPage - 1]?.key;
            if (key) s.deletePage(doc.id, key);
          }
          break;
        case 'page:duplicate': {
          const key = doc?.pages[doc.currentPage - 1]?.key;
          if (key) s.duplicatePage(doc.id, key);
          break;
        }
        case 'page:rotateLeft': {
          const key = doc?.pages[doc.currentPage - 1]?.key;
          if (key) s.rotatePage(doc.id, key, -90);
          break;
        }
        case 'page:rotateRight': {
          const key = doc?.pages[doc.currentPage - 1]?.key;
          if (key) s.rotatePage(doc.id, key, 90);
          break;
        }
        case 'view:zoomIn':
          if (doc) setZoom(doc.id, doc.zoom + 0.1);
          break;
        case 'view:zoomOut':
          if (doc) setZoom(doc.id, doc.zoom - 0.1);
          break;
        case 'view:fitWidth':
          if (doc) setFitMode(doc.id, 'width');
          break;
        case 'view:fitPage':
          if (doc) setFitMode(doc.id, 'page');
          break;
        case 'view:toggleSidebar':
          toggleSidebar();
          break;
        case 'view:toggleTheme':
          toggleTheme();
          break;
        case 'help:about':
          openDialog('about');
          break;
        default:
          break;
      }
    },
    [handleOpenDialog, doSave, openDialog, showToast, closeDocument, undo, redo, deleteSelected, setTool, setZoom, setFitMode, toggleSidebar, toggleTheme]
  );

  // Renderer-side keyboard accelerators (Ctrl+O, Ctrl+S, ...) - the sole
  // source now that main.js sets no native menu (frame:false hides it
  // anyway, and its accelerators didn't reliably fire once hidden -
  // confirmed empirically, not just theorized).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey) {
        if (e.key === 'Delete') {
          const active = document.activeElement;
          const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
          if (!typing) runMenuAction('edit:deleteSelected');
        }
        return;
      }
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (typing) return;

      const key = e.key.toLowerCase();
      const map = {
        o: 'file:open',
        s: e.shiftKey ? 'file:saveAs' : 'file:save',
        w: 'file:close',
        z: e.shiftKey ? 'edit:redo' : 'edit:undo',
        f: 'edit:find',
        t: 'tool:text',
        b: 'view:toggleSidebar',
        j: 'view:toggleTheme'
      };
      let action = map[key];
      if (!action && (key === '=' || key === '+')) action = 'view:zoomIn';
      if (!action && key === '-') action = 'view:zoomOut';
      if (!action) return;

      e.preventDefault();
      runMenuAction(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runMenuAction]);

  useEffect(() => {
    return window.pdfEditor.onFileOpenedExternally((fileMeta) => {
      openFile(fileMeta);
    });
  }, [openFile]);

  // ---- drag & drop --------------------------------------------------------
  const onDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (files.length === 0) {
        showToast('error', 'Only PDF files are supported.');
        return;
      }
      for (const f of files) {
        const meta = await fileToMeta(f);
        await openFile(meta);
      }
    },
    [openFile, showToast]
  );

  const fileInputRef = useRef(null);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <TitleBar onOpen={handleOpenDialog} />
      <MenuBar runMenuAction={runMenuAction} />
      <Toolbar onOpen={handleOpenDialog} onSave={() => doSave(false)} onSaveAs={() => doSave(true)} />

      <div className="main-area">
        <Sidebar />
        {activeDoc ? (
          <Viewer />
        ) : (
          <div className="empty-state">
            <div className={`dropzone ${dragging ? 'dragging' : ''}`}>
              <div className="dropzone-icon">
                <IconUpload />
              </div>
              <div className="dropzone-heading">Drop a PDF here</div>
              <div className="dropzone-body">Or open one from disk. Multiple files open as tabs.</div>
              <div className="dropzone-actions">
                <div className="dropzone-btn primary" onClick={handleOpenDialog}>
                  Open a PDF
                </div>
              </div>
            </div>
            {recentFiles.length > 0 && (
              <div className="recent-list">
                <span className="recent-header">Recent</span>
                {recentFiles.map((f) => (
                  <div key={f.path} className="recent-row" onClick={() => openRecent(f.path)}>
                    <div className="recent-thumb" />
                    <div className="recent-info">
                      <span className="recent-name">{f.name}</span>
                      <span className="recent-meta">
                        {f.pageCount} page{f.pageCount === 1 ? '' : 's'} · {formatRelativeTime(f.openedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeDoc && <PropertiesPanel />}
      </div>

      <StatusBar />

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      <Dialogs dialog={dialog} />

      <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} />
    </div>
  );
}
