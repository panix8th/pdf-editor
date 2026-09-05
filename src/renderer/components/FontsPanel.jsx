import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, getResource } from '../state/store';
import { inventoryDocumentFonts, classifyFonts, pickFace } from '../pdf/fontInventory';
import { loadSystemFontFamilies, loadFaceBytes, loadSystemFontIndex } from '../pdf/systemFontMatch';

/**
 * Fonts panel: what this document needs, what this machine has, and how to
 * close the gap.
 *
 * The check is the point. A PDF that references a font it doesn't embed
 * renders with whatever substitute the reader picks - silently, with no
 * indication that what you're looking at isn't what the author sent. That
 * also makes editing text look wrong, because the replacement is set in a
 * font the rest of the page isn't actually using. This panel names those
 * fonts, and offers to install them.
 */

const STATUS_META = {
  embedded: { label: 'Embedded', tone: 'ok', hint: 'Travels inside the file - renders identically everywhere.' },
  standard: { label: 'Built-in', tone: 'ok', hint: 'One of the 14 fonts every PDF reader provides.' },
  installed: { label: 'Installed', tone: 'ok', hint: 'Not embedded, but this PC has it - so it renders correctly here.' },
  missing: { label: 'Missing', tone: 'warn', hint: 'Not embedded and not installed - your reader is substituting another font.' }
};

function StatusChip({ status }) {
  const meta = STATUS_META[status];
  return (
    <span className={`font-chip ${meta.tone}`} title={meta.hint}>
      {meta.label}
    </span>
  );
}

/** One row of the document check, with the install affordances when the
 * font is one this machine can't render. */
function DocumentFontRow({ font, onInstalled }) {
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      const res = await window.pdfEditor.fonts.downloadForInstall(font.family, font.bold, font.italic);
      if (!res.ok) {
        // Google Fonts only carries open-licensed families, so proprietary
        // ones (Segoe UI, Calibri, ...) legitimately aren't there - point
        // at the other button rather than leaving a dead end.
        showToast('error', `Couldn't fetch "${font.family}" automatically (${res.error}). Try "Find online".`);
      } else if (res.opened) {
        showToast('info', `Downloaded ${font.family}. Click Install in the window that just opened, then choose Re-check.`);
      } else {
        showToast('info', `Saved ${font.family} to ${res.path}. Open it and click Install, then choose Re-check.`);
      }
      onInstalled();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="font-row">
      <div className="font-row-main">
        <span className="font-row-name" style={{ fontFamily: `"${font.family}", sans-serif` }}>
          {font.family}
        </span>
        <StatusChip status={font.status} />
      </div>
      <div className="font-row-meta">
        {font.name !== font.family ? font.name : ''}
        {font.bold ? ' · Bold' : ''}
        {font.italic ? ' · Italic' : ''}
      </div>
      {font.status === 'missing' && (
        <div className="font-row-actions">
          {/* The ellipsis is the convention for "this opens something
              else": the download lands in Downloads and the OS installer
              takes it from there - the actual install is the user's click. */}
          <button className="btn btn-sm" disabled={busy} onClick={install} title={`Download ${font.family} and open your system's font installer`}>
            {busy ? 'Getting...' : 'Install...'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => window.pdfEditor.fonts.openSpecimen(font.family)}
            title={`Look up ${font.family} in your browser`}
          >
            Find online
          </button>
        </div>
      )}
    </div>
  );
}

export default function FontsPanel({ doc }) {
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const setToolOptions = useStore((s) => s.setToolOptions);
  const showToast = useStore((s) => s.showToast);

  const [inventory, setInventory] = useState(null);
  const [families, setFamilies] = useState(null);
  const [query, setQuery] = useState('');
  const [applying, setApplying] = useState(null);
  const [rescanning, setRescanning] = useState(false);

  const selection = doc.selection;
  const selected = selection ? (doc.annotations[selection.pageKey] || []).find((a) => a.id === selection.objectId) : null;
  const selectedText = selected && selected.type === 'text' ? selected : null;

  const refresh = useCallback(
    async ({ force = false } = {}) => {
      const [faces, docFonts] = await Promise.all([
        loadSystemFontIndex({ force }),
        (async () => {
          const resources = getResource(doc.id);
          if (!resources?.originalBytes) return [];
          try {
            return await inventoryDocumentFonts(resources.originalBytes);
          } catch {
            return [];
          }
        })()
      ]);
      setInventory(classifyFonts(docFonts, faces));
      setFamilies(await loadSystemFontFamilies());
    },
    [doc.id]
  );

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {
      if (!cancelled) {
        setInventory([]);
        setFamilies([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const rescan = async () => {
    setRescanning(true);
    try {
      await refresh({ force: true });
    } finally {
      setRescanning(false);
    }
  };

  /** Embeds an installed family and points the selected text box (or, with
   * nothing selected, the Text tool's defaults) at it. */
  const apply = async (family) => {
    setApplying(family.family);
    try {
      const face = pickFace(family.faces, {
        bold: selectedText ? selectedText.bold : doc.toolOptions.bold,
        italic: selectedText ? selectedText.italic : doc.toolOptions.italic
      });
      const { bytes, family: realName } = await loadFaceBytes(face);
      const fontId = `sysfont-${face.postscriptName}-${Date.now()}`;
      registerCustomFont(doc.id, fontId, bytes, realName);
      if (selectedText) {
        updateAnnotation(doc.id, selection.pageKey, selection.objectId, { fontId, fontFamily: realName }, { record: true });
      } else {
        setToolOptions(doc.id, { fontId, fontFamily: realName });
      }
      showToast('info', selectedText ? `Applied ${realName}.` : `New text will use ${realName}.`);
    } catch (err) {
      showToast('error', `Couldn't use "${family.family}": ${err.message}`);
    } finally {
      setApplying(null);
    }
  };

  const missingCount = useMemo(() => (inventory || []).filter((f) => f.status === 'missing').length, [inventory]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!families) return [];
    return q ? families.filter((f) => f.family.toLowerCase().includes(q)) : families;
  }, [families, query]);

  if (inventory === null || families === null) return <div className="hint">Reading installed fonts...</div>;

  return (
    <div className="fonts-panel">
      <div className="fonts-section-head">
        <span>This document</span>
        <button className="btn btn-sm" disabled={rescanning} onClick={rescan} title="Re-read the fonts installed on this PC">
          {rescanning ? 'Checking...' : 'Re-check'}
        </button>
      </div>
      {inventory.length === 0 && <div className="hint">No text fonts found in this PDF.</div>}
      {missingCount > 0 && (
        <div className="font-warning">
          {missingCount} font{missingCount === 1 ? '' : 's'} {missingCount === 1 ? 'is' : 'are'} neither embedded nor
          installed here, so {missingCount === 1 ? 'it is' : 'they are'} being substituted.
        </div>
      )}
      {inventory.map((font) => (
        <DocumentFontRow key={font.name} font={font} onInstalled={rescan} />
      ))}

      <div className="fonts-section-head" style={{ marginTop: 14 }}>
        <span>Installed here</span>
        <span className="hint" style={{ margin: 0 }}>{families.length}</span>
      </div>
      <div className="hint" style={{ marginTop: 0 }}>
        {selectedText ? 'Click a font to apply it to the selected text.' : 'Click a font to use it for new text boxes.'}
      </div>
      <input
        className="field"
        placeholder="Filter fonts..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="font-list">
        {filtered.map((family) => (
          <div
            key={family.family}
            className="font-list-item"
            onClick={() => apply(family)}
            title={`${family.faces.length} style${family.faces.length === 1 ? '' : 's'}`}
          >
            {/* Previewed in the font itself - Chromium can lay out any
                installed family by name, no loading needed until it's
                actually applied. */}
            <span style={{ fontFamily: `"${family.family}", sans-serif` }}>{family.family}</span>
            {applying === family.family && <span className="hint"> embedding...</span>}
          </div>
        ))}
        {filtered.length === 0 && <div className="hint">No installed font matches that.</div>}
      </div>
    </div>
  );
}
