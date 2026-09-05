import React, { useRef } from 'react';
import { useStore } from '../state/store';
import { STANDARD_FONT_FAMILIES } from '../pdf/fonts';
import { isFieldNameTaken } from '../pdf/formFields';

const PALETTE = ['#b49bf0', '#d79bef', '#9aa8f5', '#f5d99a', '#9af5c6'];

/** Preset swatches + a custom tile that opens the native color picker
 * (its own background reflects the current color once it's not one of
 * the presets, so a custom pick doesn't look unselected). */
function ColorSwatches({ value, onChange }) {
  const lower = (value || '').toLowerCase();
  const isPreset = PALETTE.includes(lower);
  return (
    <div className="color-swatches">
      {PALETTE.map((c) => (
        <div key={c} className={`color-swatch ${lower === c ? 'selected' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <div
        className={`color-swatch custom ${!isPreset && value ? 'selected' : ''}`}
        style={!isPreset && value ? { background: value } : undefined}
        title="Custom color"
      >
        {isPreset || !value ? '+' : ''}
        <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export default function PropertiesPanel() {
  const doc = useStore((s) => s.documents[s.activeId]);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const deleteAnnotation = useStore((s) => s.deleteAnnotation);
  const setToolOptions = useStore((s) => s.setToolOptions);
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const openFontPicker = useStore((s) => s.openFontPicker);
  const openGoogleFontPicker = useStore((s) => s.openGoogleFontPicker);
  const moveAnnotationLayer = useStore((s) => s.moveAnnotationLayer);
  const showToast = useStore((s) => s.showToast);
  const fontInputRef = useRef(null);

  const selection = doc.selection;
  const selected = selection ? (doc.annotations[selection.pageKey] || []).find((a) => a.id === selection.objectId) : null;

  // Typing in a field or dragging a slider fires a change per keystroke /
  // per pixel. Recording an undo step for each of those made undo useless
  // (one press per character) and, worse, pushed real history off the end
  // of the 60-entry stack. So a run of edits to the same property of the
  // same object is one undo step: the snapshot is taken on the first
  // change of the run, and the rest ride along.
  const burstKey = useRef(null);
  const shouldRecord = (key) => {
    if (key == null) return true; // a discrete action - always its own step
    if (burstKey.current === key) return false;
    burstKey.current = key;
    return true;
  };
  /** Ends the current run, so the next edit starts a fresh undo step.
   * Wired to blur and pointerup - i.e. whenever an interaction finishes. */
  const endBurst = () => {
    burstKey.current = null;
  };

  /**
   * @param patch  properties to change
   * @param burst  a key identifying a continuous interaction (e.g.
   *   'text'), or omitted for a one-shot change that always gets its own
   *   undo step.
   */
  const target = selected
    ? {
        get: (k) => selected[k],
        set: (patch, burst) =>
          updateAnnotation(doc.id, selection.pageKey, selection.objectId, patch, {
            record: shouldRecord(burst === undefined ? null : `${selection.objectId}:${burst}`)
          })
      }
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
  const SHAPE_STROKE_TYPES = ['rect', 'ellipse', 'line', 'arrow', 'pen'];
  const showStrokeProps = SHAPE_STROKE_TYPES.includes(selected ? selected.type : doc.tool);
  const showFillProps = ['rect', 'ellipse'].includes(selected ? selected.type : doc.tool);
  const showHighlightProps = selected ? selected.type === 'highlight' : doc.tool === 'highlight';
  const capitalize = (s) => (s === 'formfield' ? 'Form Field' : `${s[0].toUpperCase()}${s.slice(1)}`);
  const toolLabel = capitalize(selected ? selected.type : doc.tool);

  return (
    <div className="properties-panel">
      <div className="pp-header">
        <span className="pp-header-title">Properties</span>
        <span className="pp-header-chip">{toolLabel}</span>
      </div>

      {showTextProps && (
        <div className="pp-section">
          <span className="pp-section-label">Font</span>
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
            <button className="btn" onClick={() => openGoogleFontPicker(doc.id, (patch) => target.set(patch))}>
              Google Fonts...
            </button>
          </div>
          <div className="btn-row">
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

          <div className="pp-section-label" style={{ marginTop: 4 }}>
            <span>Size</span>
            <span className="value">{target.get('fontSize')} px</span>
          </div>
          <input
            type="number"
            className="field"
            min="1"
            max="400"
            value={target.get('fontSize')}
            onChange={(e) => {
              // An empty or nonsensical box would otherwise set size 0 and
              // make the text silently disappear.
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) target.set({ fontSize: Math.min(400, n) }, 'fontSize');
            }}
            onBlur={endBurst}
          />

          <span className="pp-section-label" style={{ marginTop: 4 }}>Color</span>
          <ColorSwatches value={target.get('color')} onChange={(c) => target.set({ color: c })} />

          <div className="pp-row-inline" style={{ marginTop: 4 }}>
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
            <>
              <span className="pp-section-label" style={{ marginTop: 4 }}>Text</span>
              <textarea className="field" value={selected.text} onChange={(e) => target.set({ text: e.target.value }, 'text')} onBlur={endBurst} />
            </>
          )}
        </div>
      )}

      {showStrokeProps && (
        <div className="pp-section">
          <span className="pp-section-label">Stroke</span>
          <ColorSwatches value={target.get('strokeColor')} onChange={(c) => target.set({ strokeColor: c })} />
          <div className="pp-section-label" style={{ marginTop: 4 }}>
            <span>Width</span>
            <span className="value">{target.get('strokeWidth')} px</span>
          </div>
          <input
            type="range"
            className="pp-slider"
            min="1"
            max="30"
            value={target.get('strokeWidth')}
            onChange={(e) => target.set({ strokeWidth: Number(e.target.value) }, 'strokeWidth')}
            onPointerUp={endBurst}
            onBlur={endBurst}
          />
        </div>
      )}

      {showFillProps && (
        <div className="pp-section">
          <div className="pp-section-label">
            <span>Fill</span>
            {target.get('fillColor') && (
              <span className="value" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => target.set({ fillColor: '' })}>
                No fill
              </span>
            )}
          </div>
          <ColorSwatches value={target.get('fillColor') || ''} onChange={(c) => target.set({ fillColor: c })} />
          {target.get('fillColor') && (
            <>
              <div className="pp-section-label" style={{ marginTop: 4 }}>
                <span>Opacity</span>
                <span className="value">{Math.round((target.get('fillOpacity') ?? 0.3) * 100)}%</span>
              </div>
              <input
                type="range"
                className="pp-slider"
                min="0"
                max="1"
                step="0.05"
                value={target.get('fillOpacity') ?? 0.3}
                onChange={(e) => target.set({ fillOpacity: Number(e.target.value) }, 'fillOpacity')}
                onPointerUp={endBurst}
                onBlur={endBurst}
              />
            </>
          )}
        </div>
      )}

      {showHighlightProps && (
        <div className="pp-section">
          <span className="pp-section-label">Color</span>
          <ColorSwatches
            value={selected ? selected.color : doc.toolOptions.highlightColor}
            onChange={(c) => (selected ? target.set({ color: c }) : setToolOptions(doc.id, { highlightColor: c }))}
          />
          {selected && (
            <>
              <div className="pp-section-label" style={{ marginTop: 4 }}>
                <span>Opacity</span>
                <span className="value">{Math.round((selected.opacity ?? 0.4) * 100)}%</span>
              </div>
              <input
                type="range"
                className="pp-slider"
                min="0.1"
                max="0.9"
                step="0.05"
                value={selected.opacity ?? 0.4}
                onChange={(e) => target.set({ opacity: Number(e.target.value) }, 'opacity')}
                onPointerUp={endBurst}
                onBlur={endBurst}
              />
            </>
          )}
        </div>
      )}

      {!selected && doc.tool === 'formfield' && (
        <div className="pp-section">
          <span className="hint" style={{ marginTop: 0 }}>
            Draw a box on the page to add a fillable field. Its type, name, and options are set below once placed.
          </span>
        </div>
      )}

      {selected && selected.type === 'formfield' && (
        <div className="pp-section">
          <span className="pp-section-label">Field Type</span>
          <select
            className="field"
            value={selected.fieldType}
            onChange={(e) => {
              const fieldType = e.target.value;
              const patch = { fieldType, value: fieldType === 'checkbox' ? false : '' };
              if (fieldType === 'dropdown' && !(selected.options || []).length) patch.options = ['Option 1', 'Option 2'];
              target.set(patch);
            }}
          >
            <option value="text">Text Field</option>
            <option value="checkbox">Checkbox</option>
            <option value="dropdown">Dropdown</option>
          </select>

          <span className="pp-section-label" style={{ marginTop: 4 }}>Field Name</span>
          <input
            className="field"
            defaultValue={selected.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (!name) {
                e.target.value = selected.name;
                return;
              }
              if (name !== selected.name && isFieldNameTaken(doc, name, selected.id)) {
                showToast('error', `"${name}" is already used by another field in this document.`);
                e.target.value = selected.name;
                return;
              }
              target.set({ name });
            }}
          />

          {selected.fieldType === 'dropdown' && (
            <>
              <span className="pp-section-label" style={{ marginTop: 4 }}>Options (one per line)</span>
              <textarea
                className="field"
                defaultValue={(selected.options || []).join('\n')}
                onBlur={(e) => {
                  const options = e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  target.set({ options });
                }}
              />
            </>
          )}

          <div className="pp-row-inline" style={{ marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--dim)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!selected.required} onChange={(e) => target.set({ required: e.target.checked })} />
              Required
            </label>
          </div>

          <span className="pp-section-label" style={{ marginTop: 4 }}>Test value</span>
          {selected.fieldType === 'text' && (
            <input className="field" value={selected.value || ''} onChange={(e) => target.set({ value: e.target.value }, 'value')} onBlur={endBurst} />
          )}
          {selected.fieldType === 'checkbox' && (
            <input type="checkbox" checked={!!selected.value} onChange={(e) => target.set({ value: e.target.checked })} />
          )}
          {selected.fieldType === 'dropdown' && (
            <select className="field" value={selected.value || ''} onChange={(e) => target.set({ value: e.target.value })}>
              <option value="" />
              {(selected.options || []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          <span className="hint" style={{ marginTop: 4 }}>Baked as a real fillable PDF field when you save.</span>
        </div>
      )}

      {selected && (selected.type === 'image' || selected.type === 'signature') && (
        <div className="pp-section">
          <span className="hint" style={{ marginTop: 0 }}>Drag to move, drag a corner to resize.</span>
        </div>
      )}

      {selected && (
        <div className="pp-section" style={{ border: 'none' }}>
          <span className="pp-section-label">Layer order</span>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn btn-icon" title="Bring to front" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'front')}>⤒</button>
            <button className="btn btn-icon" title="Move forward" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'forward')}>↑</button>
            <button className="btn btn-icon" title="Move backward" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'backward')}>↓</button>
            <button className="btn btn-icon" title="Send to back" onClick={() => moveAnnotationLayer(doc.id, selection.pageKey, selection.objectId, 'back')}>⤓</button>
          </div>
          <button className="btn danger" style={{ marginTop: 8 }} onClick={() => deleteAnnotation(doc.id, selection.pageKey, selection.objectId)}>
            Delete Object
          </button>
        </div>
      )}
    </div>
  );
}
