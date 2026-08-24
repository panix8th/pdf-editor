import React from 'react';
import { useStore } from '../state/store';
import {
  IconOpen,
  IconSave,
  IconExport,
  IconUndo,
  IconRedo,
  IconSelect,
  IconText,
  IconImage,
  IconHighlight,
  IconRect,
  IconEllipse,
  IconLine,
  IconArrow,
  IconPen,
  IconRedact,
  IconSign,
  IconCertify
} from './Icons.jsx';

const TOOLS = [
  { id: 'select', label: 'Select', icon: IconSelect, labeled: true },
  { id: 'text', label: 'Text', icon: IconText, labeled: true },
  { id: 'image', label: 'Image', icon: IconImage, labeled: true },
  { id: 'highlight', label: 'Highlight', icon: IconHighlight, labeled: true },
  { id: 'rect', label: 'Rectangle', icon: IconRect, labeled: false },
  { id: 'ellipse', label: 'Ellipse', icon: IconEllipse, labeled: false },
  { id: 'line', label: 'Line', icon: IconLine, labeled: false },
  { id: 'arrow', label: 'Arrow', icon: IconArrow, labeled: false },
  { id: 'pen', label: 'Pen', icon: IconPen, labeled: false },
  { id: 'redact', label: 'Redact', icon: IconRedact, labeled: true }
];

export default function Toolbar({ onOpen, onSave, onSaveAs }) {
  const doc = useStore((s) => s.documents[s.activeId]);
  const setTool = useStore((s) => s.setTool);
  const setZoom = useStore((s) => s.setZoom);
  const setFitMode = useStore((s) => s.setFitMode);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openDialog = useStore((s) => s.openDialog);
  const showToast = useStore((s) => s.showToast);
  const insertImage = useStore((s) => s.insertImage);

  const requireDoc = (fn) => () => {
    if (!doc) {
      showToast('error', 'Open a PDF first.');
      return;
    }
    fn();
  };

  return (
    <div className="toolbar">
      {/* Group A - file */}
      <div className="tool-group">
        <div className="tbtn filled" onClick={onOpen} title="Open (Ctrl+O)">
          <IconOpen />
          <span>Open</span>
        </div>
        <div className={`tbtn ${!doc ? 'disabled' : ''}`} onClick={doc ? requireDoc(onSave) : undefined} title="Save (Ctrl+S)">
          <IconSave />
          <span>Save</span>
        </div>
        <div className={`tbtn ${!doc ? 'disabled' : ''}`} onClick={doc ? requireDoc(() => openDialog('exportImages')) : undefined} title="Export Pages as Images">
          <IconExport />
          <span>Export</span>
        </div>
      </div>

      <div className="tool-divider" />

      {/* Group B - history */}
      <div className="tool-group">
        <div
          className={`tbtn-icon32 ${!doc || doc.history.past.length === 0 ? 'disabled' : ''}`}
          onClick={doc && doc.history.past.length > 0 ? () => undo(doc.id) : undefined}
          title="Undo (Ctrl+Z)"
        >
          <IconUndo />
        </div>
        <div
          className={`tbtn-icon32 ${!doc || doc.history.future.length === 0 ? 'disabled' : ''}`}
          onClick={doc && doc.history.future.length > 0 ? () => redo(doc.id) : undefined}
          title="Redo (Ctrl+Shift+Z)"
        >
          <IconRedo />
        </div>
      </div>

      <div className="tool-divider" />

      {/* Group C - tools */}
      <div className={`tool-cluster ${!doc ? 'disabled' : ''}`}>
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              className={`tcbtn ${!t.labeled ? 'icon-only' : ''} ${doc?.tool === t.id ? 'active' : ''}`}
              title={t.id === 'image' ? 'Insert an image (PNG/JPG)' : t.label}
              onClick={() => {
                if (!doc) return;
                if (t.id === 'image') insertImage(doc.id);
                else setTool(doc.id, t.id);
              }}
            >
              <Icon />
              {t.labeled && <span>{t.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="tool-divider" />

      {/* Group D - signing */}
      <div className="tool-group">
        <div className={`tbtn ${!doc ? 'disabled' : ''}`} onClick={doc ? requireDoc(() => openDialog('visualSignature')) : undefined} title="Visual Signature">
          <IconSign />
          <span>Sign</span>
        </div>
        <div className={`tbtn ${!doc ? 'disabled' : ''}`} onClick={doc ? requireDoc(() => openDialog('digitalSignature')) : undefined} title="Digital Signature">
          <IconCertify />
          <span>Certify</span>
        </div>
      </div>

      {/* Group E - right cluster */}
      <div className={`tool-group ${!doc ? 'disabled' : ''}`} style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
        <div className="zoom-stepper">
          <div className="zoom-stepper-btn" onClick={() => doc && setZoom(doc.id, (doc?.zoom || 1) - 0.1)}>
            −
          </div>
          <input
            disabled={!doc}
            value={doc ? `${Math.round(doc.zoom * 100)}%` : '—'}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) setZoom(doc.id, v / 100);
            }}
          />
          <div className="zoom-stepper-btn" onClick={() => doc && setZoom(doc.id, (doc?.zoom || 1) + 0.1)}>
            +
          </div>
        </div>
        <div className={`fitwidth-btn ${doc?.fitMode === 'width' ? 'active' : ''}`} onClick={() => doc && setFitMode(doc.id, 'width')}>
          Fit width
        </div>
        <div className={`fitwidth-btn ${doc?.fitMode === 'page' ? 'active' : ''}`} onClick={() => doc && setFitMode(doc.id, 'page')}>
          Fit page
        </div>
        <div className="page-indicator">
          <input
            disabled={!doc}
            value={doc?.currentPage || ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (doc && !Number.isNaN(v) && v >= 1 && v <= doc.pageCount) setCurrentPage(doc.id, v);
            }}
          />
          <span className="page-total">/ {doc?.pageCount || 0}</span>
        </div>
      </div>
    </div>
  );
}
