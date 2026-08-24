import React, { useRef } from 'react';
import { useStore } from '../state/store';
import { STANDARD_FONT_FAMILIES } from '../pdf/fonts';

/**
 * Compact, toolbar-anchored row for configuring the CURRENT tool's defaults
 * (font, color, stroke, ...) before drawing.
 *
 * This intentionally lives here instead of in the right-hand
 * PropertiesPanel: PropertiesPanel's width participates in the viewer's
 * fit-width layout, so popping it open just because a tool was selected
 * shrank the page canvas and forced a rescale/re-render mid-draw - which is
 * what caused shapes to look "wrong" right after finishing them. This bar
 * only adds height, which fit-width layout doesn't react to.
 */
export default function ToolOptionsBar() {
  const doc = useStore((s) => s.documents[s.activeId]);
  const setToolOptions = useStore((s) => s.setToolOptions);
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const openFontPicker = useStore((s) => s.openFontPicker);
  const openGoogleFontPicker = useStore((s) => s.openGoogleFontPicker);
  const fontInputRef = useRef(null);

  if (!doc || doc.tool === 'select' || doc.selection) return null;

  const opts = doc.toolOptions;
  const set = (patch) => setToolOptions(doc.id, patch);

  const loadCustomFont = async (file) => {
    const buf = await file.arrayBuffer();
    const fontId = `font-${Date.now()}`;
    registerCustomFont(doc.id, fontId, new Uint8Array(buf), file.name.replace(/\.(ttf|otf)$/i, ''));
    set({ fontId, fontFamily: file.name.replace(/\.(ttf|otf)$/i, '') });
  };

  const showText = doc.tool === 'text';
  const showStroke = ['rect', 'line', 'arrow', 'pen'].includes(doc.tool);
  const showFill = doc.tool === 'rect';
  const showHighlight = doc.tool === 'highlight';

  return (
    <div className="tool-options-bar">
      {showText && (
        <>
          <select className="field-sm" value={opts.fontId ? `custom:${opts.fontId}` : opts.fontFamily} onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('custom:')) {
              const fontId = v.slice(7);
              const font = doc.customFontsList.find((f) => f.id === fontId);
              set({ fontId, fontFamily: font?.name || 'Custom' });
            } else {
              set({ fontId: null, fontFamily: v });
            }
          }}>
            {STANDARD_FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
            {doc.customFontsList.map((f) => (
              <option key={f.id} value={`custom:${f.id}`}>{f.name} (custom)</option>
            ))}
          </select>
          <button className="tbtn" onClick={() => openFontPicker(doc.id, (patch) => set(patch))} title="Pick from fonts installed on this PC">
            System Fonts...
          </button>
          <button className="tbtn" onClick={() => openGoogleFontPicker(doc.id, (patch) => set(patch))} title="Fetch any font from Google Fonts">
            Google Fonts...
          </button>
          <button className="tbtn" onClick={() => fontInputRef.current.click()}>
            Load .ttf/.otf...
          </button>
          <input ref={fontInputRef} type="file" accept=".ttf,.otf" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && loadCustomFont(e.target.files[0])} />
          <input type="number" className="field-sm num" value={opts.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} title="Font size" />
          <input type="color" className="field-sm swatch" value={opts.color} onChange={(e) => set({ color: e.target.value })} title="Text color" />
          <button className={`tbtn ${opts.bold ? 'active' : ''}`} onClick={() => set({ bold: !opts.bold })}>B</button>
          <button className={`tbtn ${opts.italic ? 'active' : ''}`} onClick={() => set({ italic: !opts.italic })}>I</button>
          {['left', 'center', 'right'].map((a) => (
            <button key={a} className={`tbtn ${opts.align === a ? 'active' : ''}`} onClick={() => set({ align: a })}>{a[0].toUpperCase()}</button>
          ))}
        </>
      )}
      {showStroke && (
        <>
          <label className="tob-label">Stroke</label>
          <input type="color" className="field-sm swatch" value={opts.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} />
          <input type="number" min="1" max="30" className="field-sm num" value={opts.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} />
        </>
      )}
      {showFill && (
        <>
          <label className="tob-label">Fill</label>
          <input type="color" className="field-sm swatch" value={opts.fillColor || '#ffffff'} onChange={(e) => set({ fillColor: e.target.value })} />
          <button className="tbtn" onClick={() => set({ fillColor: '' })}>No Fill</button>
        </>
      )}
      {showHighlight && (
        <>
          <label className="tob-label">Color</label>
          <input type="color" className="field-sm swatch" value={opts.highlightColor} onChange={(e) => set({ highlightColor: e.target.value })} />
        </>
      )}
    </div>
  );
}
