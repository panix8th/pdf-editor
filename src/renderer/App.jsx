import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useStore, getResource } from './state/store';
import { bakeDocument } from './pdf/documentIO';
import Toolbar from './components/Toolbar.jsx';
import ToolOptionsBar from './components/ToolOptionsBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Viewer from './components/Viewer.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import Dialogs from './components/Dialogs.jsx';

async function fileToMeta(file) {
  const buf = await file.arrayBuffer();
  return { name: file.name, path: null, data: new Uint8Array(buf) };
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const order = useStore((s) => s.order);
  const documents = useStore((s) => s.documents);
  const activeId = useStore((s) => s.activeId);
  const toast = useStore((s) => s.toast);
  const dialog = useStore((s) => s.dialog);
  const closeDocument = useStore((s) => s.closeDocument);
  const setActive = useStore((s) => s.setActive);
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

  const [dragging, setDragging] = useState(false);
  const activeDoc = documents[activeId] || null;

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

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
          updateDoc(doc.id, { dirty: false });
          showToast('info', `Saved to ${doc.filePath}`);
        } else {
          const savedPath = await window.pdfEditor.saveAs(doc.name, bytes);
          if (savedPath) {
            updateDoc(doc.id, { dirty: false, filePath: savedPath, name: savedPath.split(/[\\/]/).pop() });
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
  useEffect(() => {
    const off = window.pdfEditor.onMenuAction(({ action }) => {
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
    });
    return off;
  }, [handleOpenDialog, doSave, openDialog, showToast, closeDocument, undo, redo, deleteSelected, setTool, setZoom, setFitMode, toggleSidebar, toggleTheme]);

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
      <div className="tabbar">
        {order.map((id) => {
          const d = documents[id];
          return (
            <div key={id} className={`tab ${id === activeId ? 'active' : ''}`} onClick={() => setActive(id)}>
              <span className="tab-name" title={d.name}>
                {d.name}
              </span>
              {d.dirty && <span className="tab-dirty">●</span>}
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDocument(id);
                }}
              >
                ×
              </span>
            </div>
          );
        })}
        {order.length === 0 && <div className="tab-empty-hint">No documents open</div>}
      </div>

      <Toolbar onOpen={handleOpenDialog} onSave={() => doSave(false)} onSaveAs={() => doSave(true)} />
      <ToolOptionsBar />

      <div className="main-area">
        <Sidebar />
        {activeDoc ? (
          <Viewer />
        ) : (
          <div className="empty-state">
            <div className={`dropzone ${dragging ? 'dragging' : ''}`}>
              <p>Drag &amp; drop PDF files here</p>
              <p>or</p>
              <button className="btn primary" onClick={handleOpenDialog}>
                Open a PDF
              </button>
            </div>
          </div>
        )}
        {activeDoc && activeDoc.selection && <PropertiesPanel />}
      </div>

      <StatusBar />

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      <Dialogs dialog={dialog} />

      <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} />
    </div>
  );
}
