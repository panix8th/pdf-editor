import React from 'react';
import { useStore } from '../state/store';

const TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'rect', label: 'Rect' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'pen', label: 'Pen' },
  { id: 'redact', label: 'Redact' }
];

export default function Toolbar({ onOpen, onSave, onSaveAs }) {
  const doc = useStore((s) => s.documents[s.activeId]);
  const setTool = useStore((s) => s.setTool);
  const setZoom = useStore((s) => s.setZoom);
  const setFitMode = useStore((s) => s.setFitMode);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const theme = useStore((s) => s.theme);
  const openDialog = useStore((s) => s.openDialog);
  const showToast = useStore((s) => s.showToast);

  const requireDoc = (fn) => () => {
    if (!doc) {
      showToast('error', 'Open a PDF first.');
      return;
    }
    fn();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="tbtn" onClick={onOpen} title="Open (Ctrl+O)">
          Open
        </button>
        <button className="tbtn" onClick={requireDoc(onSave)} title="Save (Ctrl+S)" disabled={!doc}>
          Save
        </button>
        <button className="tbtn" onClick={requireDoc(onSaveAs)} title="Save As (Ctrl+Shift+S)" disabled={!doc}>
          Save As
        </button>
      </div>

      <div className="toolbar-group">
        <button className="tbtn" disabled={!doc || doc.history.past.length === 0} onClick={() => undo(doc.id)} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="tbtn" disabled={!doc || doc.history.future.length === 0} onClick={() => redo(doc.id)} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>

      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tbtn ${doc?.tool === t.id ? 'active' : ''}`}
            disabled={!doc}
            onClick={() => setTool(doc.id, t.id)}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button className="tbtn" disabled={!doc} onClick={requireDoc(() => openDialog('visualSignature'))} title="Visual Signature">
          Sign
        </button>
        <button className="tbtn" disabled={!doc} onClick={requireDoc(() => openDialog('digitalSignature'))} title="Digital Signature">
          Sign (Digital)
        </button>
      </div>

      <div className="toolbar-group">
        <div className="zoom-box">
          <button className="tbtn" disabled={!doc} onClick={() => setZoom(doc.id, (doc?.zoom || 1) - 0.1)}>
            −
          </button>
          <input
            disabled={!doc}
            value={doc ? `${Math.round(doc.zoom * 100)}%` : ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) setZoom(doc.id, v / 100);
            }}
          />
          <button className="tbtn" disabled={!doc} onClick={() => setZoom(doc.id, (doc?.zoom || 1) + 0.1)}>
            +
          </button>
        </div>
        <button className={`tbtn ${doc?.fitMode === 'width' ? 'active' : ''}`} disabled={!doc} onClick={() => setFitMode(doc.id, 'width')}>
          Fit Width
        </button>
        <button className={`tbtn ${doc?.fitMode === 'page' ? 'active' : ''}`} disabled={!doc} onClick={() => setFitMode(doc.id, 'page')}>
          Fit Page
        </button>
        <div className="pagejump">
          <input
            disabled={!doc}
            value={doc?.currentPage || ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 1 && v <= doc.pageCount) setCurrentPage(doc.id, v);
            }}
          />
          <span> / {doc?.pageCount || 0}</span>
        </div>
      </div>

      <div className="toolbar-group">
        <button className="tbtn" onClick={toggleSidebar} title="Toggle Sidebar (Ctrl+B)">
          Sidebar
        </button>
        <button className="tbtn" onClick={toggleTheme} title="Toggle Theme (Ctrl+J)">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </div>
  );
}
