import React, { useRef } from 'react';
import { useStore } from '../state/store';
import { STANDARD_FONT_FAMILIES } from '../pdf/fonts';

export default function PropertiesPanel() {
  const doc = useStore((s) => s.documents[s.activeId]);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const deleteAnnotation = useStore((s) => s.deleteAnnotation);
  const setToolOptions = useStore((s) => s.setToolOptions);
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const openFontPicker = useStore((s) => s.openFontPicker);
  const moveAnnotationLayer = useStore((s) => s.moveAnnotationLayer);
  const fontInputRef = useRef(null);

  const selection = doc.selection;
  const selected = selection ? (doc.annotations[selection.pageKey] || []).find((a) => a.id === selection.objectId) : null;

  const target = selected
    ? { get: (k) => selected[k], set: (patch) => updateAnnotation(doc.id, selection.pageKey, selection.objectId, patch, { record: true }) }
    : { get: (k) => doc.toolOptions[k], set: (patch) => setToolOptions(doc.id, patch) };

  const fontFamilyValue = selected ? (selected.fontId ? `custom:${selected.fontId}` : selected.fontFamily) : doc.toolOptions.fontId ? `custom:${doc.toolOptions.fontId}` : doc.toolOptions.fontFamily;

  const onFontFamilyChange = (val) => {
    if (val.startsWith('custom:')) {
      const fontId = val.slice(7);
      const font = doc.customFontsList.find((f) => f.id === fontId);
      target.set({ fontId, fontFamily: font?.name || 'Custom' });
    } else {
      target.set({ fontId: null, fontFamily: val });
    }
  };

  const loadCustomFont = async (file) => {
    const buf = await file.arrayBuffer();
    const fontId = `font-${Date.now()}`;
    registerCustomFont(doc.id, fontId, new Uint8Array(buf), file.name.replace(/\.(ttf|otf)$/i, ''));
    onFontFamilyChange(`custom:${fontId}`);
  };

  const showTextProps = selected ? selected.type === 'text' : doc.tool === 'text';
  const showStrokeProps = selected ? ['rect', 'line', 'arrow', 'pen'].includes(selected.type) : ['rect', 'line', 'arrow', 'pen'].includes(doc.tool);
  const showFillProps = selected ? selected.type === 'rect' : doc.tool === 'rect';
  const showHighlightProps = selected ? selected.type === 'highlight' : doc.tool === 'highlight';

  return (
    <div className="properties-panel">
      <div className="pp-title">{selected ? 'Object Properties' : `${doc.tool[0].toUpperCase()}${doc.tool.slice(1)} Tool Defaults`}</div>

      {showTextProps && (
        <>
          <div className="pp-row">
            <label>Font Family</label>
            <select className="field" value={fontFamilyValue} onChange={(e) => onFontFamilyChange(e.target.value)}>
              {STANDARD_FONT_FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
              {doc.customFontsList.map((f) => (
                <option key={f.id} value={`custom:${f.id}`}>
                  {f.name} (custom)
                </option>
              ))}
            </select>
            <div className="btn-row">
              <button className="btn" onClick={() => openFontPicker(doc.id, (patch) => target.set(patch))}>
                System Fonts...
              </button>
              <button className="btn" onClick={() => fontInputRef.current.click()}>
                Load .ttf / .otf...
              </button>
            </div>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && loadCustomFont(e.target.files[0])}
            />
          </div>
          <div className="pp-row">
            <label>Size</label>
            <input
              type="number"
              className="field"
              value={target.get('fontSize')}
              onChange={(e) => target.set({ fontSize: Number(e.target.value) })}
            />
          </div>
          <div className="pp-row">
            <label>Color</label>
            <input type="color" className="field" value={target.get('color')} onChange={(e) => target.set({ color: e.target.value })} />
          </div>
          <div className="pp-row pp-row-inline">
            <button className={`btn ${target.get('bold') ? 'primary' : ''}`} onClick={() => target.set({ bold: !target.get('bold') })}>
              B
            </button>
            <button className={`btn ${target.get('italic') ? 'primary' : ''}`} onClick={() => target.set({ italic: !target.get('italic') })}>
              I
            </button>
            {['left', 'center', 'right'].map((a) => (
              <button key={a} className={`btn ${target.get('align') === a ? 'primary' : ''}`} onClick={() => target.set({ align: a })}>
                {a[0].toUpperCase()}
              </button>
            ))}
          </div>
          {selected && (
            <div className="pp-row">
              <label>Text</label>
              <textarea className="field" value={selected.text} onChange={(e) => target.set({ text: e.target.value })} />
            </div>
          )}
        </>
      )}

      {showStrokeProps && (
        <>
          <div className="pp-row">
            <label>Stroke Color</label>
            <input type="color" className="field" value={target.get('strokeColor')} onChange={(e) => target.set({ strokeColor: e.target.value })} />
          </div>
          <div className="pp-row">
            <label>Stroke Width</label>
            <input
              type="number"
              min="1"
              max="30"
              className="field"
              value={target.get('strokeWidth')}
              onChange={(e) => target.set({ strokeWidth: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {showFillProps && (
        <>
          <div className="pp-row">
            <label>Fill Color (optional)</label>
            <input
              type="color"
              className="field"
              value={target.get('fillColor') || '#ffffff'}
              onChange={(e) => target.set({ fillColor: e.target.value })}
            />
            <button className="btn" onClick={() => target.set({ fillColor: '' })}>
              No Fill
            </button>
          </div>
          <div className="pp-row">
            <label>Fill Opacity</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={target.get('fillOpacity') ?? 0.3}
              onChange={(e) => target.set({ fillOpacity: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {showHighlightProps && (
        <>
          <div className="pp-row">
            <label>Highlight Color</label>
            <input
              type="color"
              className="field"
              value={selected ? selected.color : doc.toolOptions.highlightColor}
              onChange={(e) => (selected ? target.set({ color: e.target.value }) : setToolOptions(doc.id, { highlightColor: e.target.value }))}
            />
          </div>
          {selected && (
            <div className="pp-row">
              <label>Opacity</label>
              <input type="range" min="0.1" max="0.9" step="0.05" value={selected.opacity ?? 0.4} onChange={(e) => target.set({ opacity: Number(e.target.value) })} />
            </div>
          )}
        </>
      )}

      {selected && (selected.type === 'image' || selected.type === 'signature') && (
        <div className="hint">Drag to move, drag a corner to resize.</div>
      )}

      {selected && (
        <>
          <div className="pp-row">
            <label>Layer order</label>
            <div className="btn-row">
              <button className="btn btn-icon" title="Bring to front" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'front')}>⤒</button>
              <button className="btn btn-icon" title="Move forward" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'forward')}>↑</button>
              <button className="btn btn-icon" title="Move backward" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'backward')}>↓</button>
              <button className="btn btn-icon" title="Send to back" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'back')}>⤓</button>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn danger" onClick={() => deleteAnnotation(doc.id, selection.pageKey, selection.objectId)}>
              Delete Object
            </button>
          </div>
        </>
      )}
    </div>
  );
}
