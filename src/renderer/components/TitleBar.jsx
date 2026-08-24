import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import PaperlightMark from './PaperlightMark.jsx';
import { IconMinus, IconRestore, IconClose } from './Icons.jsx';

/**
 * Custom frameless title bar: app mark + name, document tabs, and the
 * window's own minimize/maximize/close (the native frame that would
 * normally provide these is turned off in main.js so the design's tab
 * strip can live in the same row as the app icon).
 */
export default function TitleBar({ onOpen }) {
  const order = useStore((s) => s.order);
  const documents = useStore((s) => s.documents);
  const activeId = useStore((s) => s.activeId);
  const closeDocument = useStore((s) => s.closeDocument);
  const setActive = useStore((s) => s.setActive);

  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    window.pdfEditor.windowControls.isMaximized().then(setIsMaximized);
    return window.pdfEditor.windowControls.onMaximizedChange(setIsMaximized);
  }, []);

  return (
    <div className="titlebar" onDoubleClick={() => window.pdfEditor.windowControls.maximizeToggle()}>
      <div className="titlebar-brand">
        <span className="titlebar-mark">
          <PaperlightMark size={13} />
        </span>
        <span className="titlebar-name">Paperlight</span>
        <span className="titlebar-subtitle">PDF Editor</span>
      </div>

      <div className="titlebar-tabs">
        {order.map((id) => {
          const d = documents[id];
          return (
            <div key={id} className={`doctab ${id === activeId ? 'active' : ''}`} onClick={() => setActive(id)} title={d.name}>
              <span className="doctab-name">{d.name}</span>
              {d.dirty && <span className="doctab-dirty" />}
              <span
                className="doctab-close"
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
        <div className="doctab-new" onClick={onOpen} title="Open a PDF">
          +
        </div>
      </div>

      <div className="titlebar-controls">
        <div className="winctl" title="Minimize" onClick={() => window.pdfEditor.windowControls.minimize()}>
          <IconMinus />
        </div>
        <div className="winctl" title={isMaximized ? 'Restore' : 'Maximize'} onClick={() => window.pdfEditor.windowControls.maximizeToggle()}>
          <IconRestore />
        </div>
        <div className="winctl close" title="Close" onClick={() => window.pdfEditor.windowControls.close()}>
          <IconClose />
        </div>
      </div>
    </div>
  );
}
