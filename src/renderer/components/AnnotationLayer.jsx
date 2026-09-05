import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { v4 as uuid } from 'uuid';
import { useStore } from '../state/store';
import {
  screenPointToStorage,
  screenRectToStorage,
  storageRectToScreen,
  storagePointToScreen,
  screenDeltaToStorage
} from '../pdf/coords';
import { isCustomFont } from '../pdf/fonts';
import { extractTextRuns, guessStandardFamily } from '../pdf/textRuns';
import { resolveGoogleFontCandidates } from '../pdf/googleFontMap';
import { resolveAndCacheGoogleFont } from '../pdf/fetchAndCacheGoogleFont';
import { findAndLoadSystemFont } from '../pdf/systemFontMatch';
import { getCachedResolvedFontId, cacheResolvedFontId } from '../state/docResources';
import { arrowGeometry, pointsAttr, DEFAULT_FILL_OPACITY } from '../pdf/shapeGeometry';
import { FIELD_TYPE_LABELS, nextFieldName } from '../pdf/formFields';
import {
  textPositionAt,
  runAtPoint,
  selectionRects,
  selectedText,
  selectedRuns,
  isEmptySelection,
  wordRangeAt,
  lineRangeAt
} from '../pdf/textSelection';

const BOX_TOOLS = new Set(['rect', 'ellipse', 'highlight', 'redact', 'formfield']);
const LINE_TOOLS = new Set(['line', 'arrow']);

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Approximates the original run's background color by sampling the
 * already-rendered page canvas just outside the run (since we don't have
 * the PDF's actual paint operators - just this text's position), so the
 * cover rectangle blends in. Text color defaults to black rather than
 * also being sampled: at typical body-text sizes a run only spans a
 * handful of screen pixels, so picking a single "darkest pixel" from
 * anti-aliased glyph edges is noisy and can land on a stray tinted pixel
 * instead of the glyph's true color. Black is right for the vast
 * majority of real documents, and it's a one-click fix in the properties
 * panel otherwise. */
function sampleBackgroundColor(canvas, screenRect) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bgPoints = [
      [screenRect.x + 2, screenRect.y - 3],
      [screenRect.x + screenRect.w - 2, screenRect.y - 3]
    ];
    let br = 0, bg = 0, bb = 0, bn = 0;
    for (const [px, py] of bgPoints) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(px)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(py)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      br += d[0]; bg += d[1]; bb += d[2]; bn++;
    }
    return rgbToHex(br / bn, bg / bn, bb / bn);
  } catch {
    return '#ffffff';
  }
}

export default function AnnotationLayer({ doc, page, pageIndex, pdfPage, scale, rotation, pxW, pxH }) {
  const overlayRef = useRef(null);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const selectObject = useStore((s) => s.selectObject);
  const setTool = useStore((s) => s.setTool);
  const showToast = useStore((s) => s.showToast);
  const registerCustomFont = useStore((s) => s.registerCustomFont);

  const annotations = doc.annotations[page.key] || [];
  const tool = doc.tool;
  const toolOptions = doc.toolOptions;
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [textRuns, setTextRuns] = useState([]);
  const [textOpCount, setTextOpCount] = useState(0);
  // Character-level text selection as {anchor, focus} positions in run
  // order, or null. Deliberately separate from object selection.
  const [textSelection, setTextSelection] = useState(null);
  const [hoveringText, setHoveringText] = useState(false);

  const liveViewport = useMemo(() => pdfPage.getViewport({ scale, rotation }), [pdfPage, scale, rotation]);

  const isSelected = (id) => doc.selection && doc.selection.pageKey === page.key && doc.selection.objectId === id;

  const getOffset = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Lets the "select" tool double as a text layer: extract every run on
  // this page once so text can be selected, copied and edited in place.
  useEffect(() => {
    if (pdfPage.isFake) {
      setTextRuns([]);
      setTextOpCount(0);
      return;
    }
    let cancelled = false;
    extractTextRuns(pdfPage).then(({ runs, textOpCount: count }) => {
      if (cancelled) return;
      setTextRuns(runs);
      setTextOpCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfPage]);

  // Joins multiple selected text runs into one block of text, in their
  // original stream order (already close enough to reading order for the
  // common case), inserting a newline between runs that sit on visually
  // different lines and a space between runs that share a line.
  const joinRunsText = (runs) => {
    let text = '';
    let prevY = null;
    let prevH = null;
    for (const run of runs) {
      if (prevY !== null) {
        const threshold = (prevH || run.rect.h) * 0.6;
        text += Math.abs(run.rect.y - prevY) > threshold ? '\n' : ' ';
      }
      text += run.str;
      prevY = run.rect.y;
      prevH = run.rect.h;
    }
    return text;
  };

  // Creates one editable text annotation covering the runs a text
  // selection touched (merged into a single box when there's more than
  // one), auto-detecting font/color/size from the first run and upgrading
  // to the real font in the background.
  const createEditableAnnotationFromRuns = (runs) => {
    const first = runs[0];
    const minX = Math.min(...runs.map((r) => r.rect.x));
    const minY = Math.min(...runs.map((r) => r.rect.y));
    const maxX = Math.max(...runs.map((r) => r.rect.x + r.rect.w));
    const maxY = Math.max(...runs.map((r) => r.rect.y + r.rect.h));
    const pad = 1;
    const box = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    const text = runs.length > 1 ? joinRunsText(runs) : first.str;

    const screenRect = storageRectToScreen(pdfPage, liveViewport, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    const canvas = overlayRef.current?.parentElement?.querySelector('canvas');
    const bgColor = canvas ? sampleBackgroundColor(canvas, screenRect) : '#ffffff';
    const id = uuid();
    // Create with an instant, offline guess so the editor opens immediately
    // - never block on the network - then silently upgrade to the real
    // font underneath the user if/once a match comes back.
    addAnnotation(doc.id, page.key, {
      id,
      type: 'text',
      ...box,
      text,
      fontFamily: guessStandardFamily(first.fontFamilyHint),
      fontId: null,
      fontSize: first.fontSize,
      color: first.color || '#000000',
      bold: first.bold,
      italic: first.italic,
      align: 'left',
      // The save path makes exactly these operators' glyphs invisible in
      // the content stream, so the replacement lands on empty space.
      // coverRect/coverColor stay as the fallback for pages where that
      // isn't possible (see hideReplacedTextRuns in documentIO).
      sourceOpIndices: runs.every((r) => typeof r.opIndex === 'number') ? runs.map((r) => r.opIndex) : null,
      sourceTextOpCount: textOpCount,
      coverRect: box,
      coverColor: bgColor
    });
    setTextSelection(null);
    setEditingId(id);

    // Try to upgrade from the instant offline guess to the real font, best
    // match first: (1) the exact font already installed on this PC - no
    // network, no substitute, the actual original glyphs; (2) failing
    // that, Google Fonts (exact name, then a metric-compatible
    // substitute). Never blocks the edit either way.
    (async () => {
      const sysCacheKey = `sys:${first.realFontName || first.fontFamilyHint}:${first.bold}:${first.italic}`;
      const cachedSysFontId = getCachedResolvedFontId(doc.id, sysCacheKey);
      if (cachedSysFontId) {
        const cachedName = doc.customFontsList.find((f) => f.id === cachedSysFontId)?.name;
        if (cachedName) {
          updateAnnotation(doc.id, page.key, id, { fontFamily: cachedName, fontId: cachedSysFontId }, { record: false });
          return;
        }
      }
      const sysMatch = await findAndLoadSystemFont(first.realFontName, first.fontFamilyHint, { bold: first.bold, italic: first.italic }).catch(() => null);
      if (sysMatch) {
        const fontId = `sysfont-${sysMatch.family}-${Date.now()}`;
        registerCustomFont(doc.id, fontId, sysMatch.bytes, sysMatch.family);
        cacheResolvedFontId(doc.id, sysCacheKey, fontId);
        updateAnnotation(doc.id, page.key, id, { fontFamily: sysMatch.family, fontId }, { record: false });
        return;
      }

      const candidates = resolveGoogleFontCandidates(first.realFontName, first.fontFamilyHint);
      if (candidates.length === 0) return;
      const match = await resolveAndCacheGoogleFont(doc.id, candidates, { bold: first.bold, italic: first.italic, registerCustomFont }).catch(() => null);
      if (match) updateAnnotation(doc.id, page.key, id, { fontFamily: match.fontFamily, fontId: match.fontId }, { record: false });
      // Otherwise offline, no match anywhere, or a request timed out - the
      // annotation already has a sensible offline fallback font.
    })();
  };

  /** Turns the current text selection into an editable box, replacing the
   * whole runs it touches (the save path hides whole content-stream
   * operators, so partial-run edits aren't a thing). */
  const editSelection = () => {
    const runs = selectedRuns(textRuns, textSelection);
    if (runs.length > 0) createEditableAnnotationFromRuns(runs);
    // createEditableAnnotationFromRuns clears the selection itself.
  };

  const copySelection = () => {
    const text = selectedText(textRuns, textSelection);
    if (!text) return;
    // Electron's clipboard first: navigator.clipboard is permission-gated
    // and rejects silently when the document isn't focused. The web API is
    // only the fallback for running the renderer in a plain browser.
    if (window.pdfEditor?.writeClipboardText) {
      window.pdfEditor.writeClipboardText(text).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    showToast('success', `Copied ${text.length} character${text.length === 1 ? '' : 's'}`);
  };

  // Both actions close over things that change independently of the
  // selection (the live viewport, the annotation store), so the keyboard
  // handler reads them through a ref that's refreshed every render rather
  // than capturing whichever copies existed when it was bound.
  const selectionActions = useRef({ editSelection, copySelection });
  useEffect(() => {
    selectionActions.current = { editSelection, copySelection };
  });

  // Picking up a drawing tool means the user is done with the text they
  // had selected; leaving the highlight up would just be stale decoration
  // that reappears the moment they switch back to Select.
  useEffect(() => {
    if (tool !== 'select') setTextSelection(null);
  }, [tool]);

  // Ctrl+C / Enter / Escape while text is selected. Bound on the window
  // because the page overlay isn't focusable - but every branch bails out
  // when the user is typing into a field somewhere else in the app.
  useEffect(() => {
    if (tool !== 'select' || isEmptySelection(textSelection)) return;
    const onKey = (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'Escape') {
        setTextSelection(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectionActions.current.editSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        selectionActions.current.copySelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, textSelection]);

  const onOverlayMouseMove = (e) => {
    if (tool !== 'select') {
      if (hoveringText) setHoveringText(false);
      return;
    }
    const { x, y } = getOffset(e);
    const [sx, sy] = screenPointToStorage(pdfPage, liveViewport, x, y);
    const over = runAtPoint(textRuns, sx, sy) >= 0;
    if (over !== hoveringText) setHoveringText(over);
  };

  // Floating actions sit just under the end of the selection.
  const selectionToolbar = useMemo(() => {
    if (isEmptySelection(textSelection)) return null;
    const rects = selectionRects(textRuns, textSelection);
    if (rects.length === 0) return null;
    const last = rects[rects.length - 1];
    const screen = storageRectToScreen(pdfPage, liveViewport, last);
    return { x: screen.x, y: screen.y + screen.h + 6 };
  }, [textRuns, textSelection, pdfPage, liveViewport]);

  const commitNewShape = useCallback(
    (type, screenRect, extra) => {
      const storageRect = screenRectToStorage(pdfPage, liveViewport, screenRect);
      if (storageRect.w < 3 && storageRect.h < 3 && type !== 'pen') return;
      const base = { id: uuid(), type, ...storageRect, ...extra };
      addAnnotation(doc.id, page.key, base);
    },
    [addAnnotation, doc.id, page.key, pdfPage, liveViewport]
  );

  const onOverlayMouseDown = (e) => {
    if (tool === 'select') {
      // Only the select tool cares about "did this press land on an empty
      // part of the page" - existing objects handle their own clicks and
      // stop this from firing for them.
      if (e.target !== overlayRef.current) return;

      // Dragging over the page selects text, exactly like any PDF viewer:
      // press, drag to extend, release. Whole-object selection is handled
      // by the objects themselves, so this layer is purely about text.
      const { x: startX, y: startY } = getOffset(e);
      const [sx, sy] = screenPointToStorage(pdfPage, liveViewport, startX, startY);
      const anchor = textPositionAt(textRuns, sx, sy);
      selectObject(doc.id, page.key, null);

      if (!anchor) {
        setTextSelection(null);
        return;
      }

      // Double-click selects the word, triple-click the whole line - the
      // same escalation every text view uses, and the fastest way to grab
      // a line for editing.
      if (e.detail >= 3) {
        const line = lineRangeAt(textRuns, anchor.runIdx);
        setTextSelection({
          anchor: { runIdx: line.from, charIdx: 0 },
          focus: { runIdx: line.to, charIdx: textRuns[line.to].str.length }
        });
        return;
      }
      if (e.detail === 2) {
        const run = textRuns[anchor.runIdx];
        const { from, to } = wordRangeAt(run, anchor.charIdx);
        setTextSelection({ anchor: { runIdx: anchor.runIdx, charIdx: from }, focus: { runIdx: anchor.runIdx, charIdx: to } });
        return;
      }

      setTextSelection({ anchor, focus: anchor });

      const onMove = (ev) => {
        const { x, y } = getOffset(ev);
        const [mx, my] = screenPointToStorage(pdfPage, liveViewport, x, y);
        const focus = textPositionAt(textRuns, mx, my);
        if (focus) setTextSelection((sel) => (sel ? { anchor: sel.anchor, focus } : sel));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }
    // Any other (drawing) tool should start drawing at this point even if
    // the click happened to land over an existing object - existing
    // objects only intercept clicks while the select tool is active (see
    // BoxShape/StrokeShape's `interactive` guard).
    const { x, y } = getOffset(e);

    if (tool === 'text') {
      const [sx, sy] = [x, y];
      const storagePt = screenPointToStorage(pdfPage, liveViewport, sx, sy);
      const w = 200;
      const h = Math.max(30, toolOptions.fontSize * 1.6);
      const ann = {
        id: uuid(),
        type: 'text',
        x: storagePt[0],
        y: storagePt[1],
        w,
        h,
        text: 'Text',
        fontFamily: toolOptions.fontFamily,
        fontId: isCustomFont(toolOptions.fontFamily) ? toolOptions.fontId : null,
        fontSize: toolOptions.fontSize,
        color: toolOptions.color,
        bold: toolOptions.bold,
        italic: toolOptions.italic,
        align: toolOptions.align
      };
      addAnnotation(doc.id, page.key, ann);
      setTool(doc.id, 'select');
      // Deferred: the click that creates this box is still mid-gesture
      // (mousedown now, mouseup/click to follow at the same point, which
      // is this box's top-left corner). Entering edit mode - and
      // autofocusing a textarea - synchronously here races that pending
      // mouseup: by the time it fires, the box is already interactive and
      // sits right under the pointer, so a resize-handle hit steals focus
      // straight back off the textarea. Waiting a tick lets the click
      // gesture finish first.
      setTimeout(() => setEditingId(ann.id), 0);
      return;
    }

    if (BOX_TOOLS.has(tool) || LINE_TOOLS.has(tool) || tool === 'pen') {
      setDraft({ tool, startX: x, startY: y, x, y, points: [{ x, y }] });
      const onMove = (ev) => {
        const { x: mx, y: my } = getOffset(ev);
        setDraft((d) => (d ? { ...d, x: mx, y: my, points: tool === 'pen' ? [...d.points, { x: mx, y: my }] : d.points } : d));
      };
      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const { x: ex, y: ey } = getOffset(ev);
        if (tool === 'rect' || tool === 'ellipse') {
          commitNewShape(tool, { x: Math.min(x, ex), y: Math.min(y, ey), w: Math.abs(ex - x), h: Math.abs(ey - y) }, {
            strokeColor: toolOptions.strokeColor,
            strokeWidth: toolOptions.strokeWidth,
            fillColor: toolOptions.fillColor || undefined,
            fillOpacity: toolOptions.fillOpacity
          });
        } else if (tool === 'highlight') {
          commitNewShape('highlight', { x: Math.min(x, ex), y: Math.min(y, ey), w: Math.abs(ex - x), h: Math.abs(ey - y) }, {
            color: toolOptions.highlightColor,
            opacity: 0.4
          });
        } else if (tool === 'redact') {
          commitNewShape('redact', { x: Math.min(x, ex), y: Math.min(y, ey), w: Math.abs(ex - x), h: Math.abs(ey - y) }, {});
          showToast('info', 'Redaction area marked. It is permanently flattened when you save.');
        } else if (tool === 'formfield') {
          commitNewShape('formfield', { x: Math.min(x, ex), y: Math.min(y, ey), w: Math.abs(ex - x), h: Math.abs(ey - y) }, {
            fieldType: 'text',
            name: nextFieldName(doc),
            options: [],
            required: false,
            value: ''
          });
        } else if (tool === 'line' || tool === 'arrow') {
          const p1 = screenPointToStorage(pdfPage, liveViewport, x, y);
          const p2 = screenPointToStorage(pdfPage, liveViewport, ex, ey);
          if (Math.hypot(ex - x, ey - y) > 3) {
            addAnnotation(doc.id, page.key, {
              id: uuid(),
              type: tool,
              x1: p1[0],
              y1: p1[1],
              x2: p2[0],
              y2: p2[1],
              strokeColor: toolOptions.strokeColor,
              strokeWidth: toolOptions.strokeWidth
            });
          }
        } else if (tool === 'pen') {
          setDraft((d) => {
            if (d && d.points.length > 1) {
              const storagePoints = d.points.map((p) => screenPointToStorage(pdfPage, liveViewport, p.x, p.y)).map(([sx2, sy2]) => ({ x: sx2, y: sy2 }));
              addAnnotation(doc.id, page.key, {
                id: uuid(),
                type: 'pen',
                points: storagePoints,
                strokeColor: toolOptions.strokeColor,
                strokeWidth: toolOptions.strokeWidth
              });
            }
            return null;
          });
        }
        setDraft(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="page-overlay"
      style={{ cursor: tool === 'select' ? (hoveringText ? 'text' : 'default') : 'crosshair' }}
      onMouseDown={onOverlayMouseDown}
      onMouseMove={onOverlayMouseMove}
    >
      {tool === 'select' &&
        selectionRects(textRuns, textSelection).map((rect, i) => {
          const r = storageRectToScreen(pdfPage, liveViewport, rect);
          return (
            <div
              key={i}
              className="text-selection"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            />
          );
        })}

      {/* Anchored to the end of the selection so it never covers the text
          being read, and only once something is actually selected. */}
      {tool === 'select' && selectionToolbar && (
        <div className="text-selection-toolbar" style={{ left: selectionToolbar.x, top: selectionToolbar.y }}>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={editSelection} title="Replace this text (Enter)">
            Edit text
          </button>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={copySelection} title="Copy (Ctrl+C)">
            Copy
          </button>
        </div>
      )}

      {/* Rendered in annotation-array order so DOM (paint) order always
          matches the layer order the user sees/edits in the Layers panel,
          regardless of whether a given object is SVG-based (line/arrow/
          pen) or div-based (everything else). */}
      {annotations.map((a) => {
        const isStroke = a.type === 'line' || a.type === 'arrow' || a.type === 'pen';
        if (isStroke) {
          return (
            <svg key={a.id} width={pxW} height={pxH} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <StrokeShape
                ann={a}
                pdfPage={pdfPage}
                liveViewport={liveViewport}
                selected={isSelected(a.id)}
                onSelect={() => tool === 'select' && selectObject(doc.id, page.key, a.id)}
                onChange={(patch, record) => updateAnnotation(doc.id, page.key, a.id, patch, { record })}
                interactive={tool === 'select'}
              />
            </svg>
          );
        }
        return (
          <BoxShape
            key={a.id}
            ann={a}
            doc={doc}
            page={page}
            pdfPage={pdfPage}
            liveViewport={liveViewport}
            selected={isSelected(a.id)}
            editing={editingId === a.id}
            onStartEdit={() => setEditingId(a.id)}
            onStopEdit={() => setEditingId(null)}
            onSelect={() => selectObject(doc.id, page.key, a.id)}
            onChange={(patch, record) => updateAnnotation(doc.id, page.key, a.id, patch, { record })}
            interactive={tool === 'select'}
          />
        );
      })}

      {(draft?.tool === 'line' || draft?.tool === 'arrow' || draft?.tool === 'pen') && (
        <svg width={pxW} height={pxH} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {draft.tool === 'line' && (
            <line x1={draft.startX} y1={draft.startY} x2={draft.x} y2={draft.y} stroke={toolOptions.strokeColor} strokeWidth={toolOptions.strokeWidth * liveViewport.scale} strokeDasharray="4 3" />
          )}
          {/* The in-progress arrow previews its real shape (shaft + solid
              head), so releasing the mouse doesn't change what you saw. */}
          {draft.tool === 'arrow' &&
            (() => {
              const g = arrowGeometry(draft.startX, draft.startY, draft.x, draft.y, toolOptions.strokeWidth * liveViewport.scale);
              return (
                <>
                  <line x1={g.shaft.x1} y1={g.shaft.y1} x2={g.shaft.x2} y2={g.shaft.y2} stroke={toolOptions.strokeColor} strokeWidth={toolOptions.strokeWidth * liveViewport.scale} />
                  {g.head.length === 3 && <polygon points={pointsAttr(g.head)} fill={toolOptions.strokeColor} />}
                </>
              );
            })()}
          {draft.tool === 'pen' && (
            <polyline
              points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={toolOptions.strokeColor}
              strokeWidth={toolOptions.strokeWidth * liveViewport.scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}

      {draft && BOX_TOOLS.has(draft.tool) && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(draft.startX, draft.x),
            top: Math.min(draft.startY, draft.y),
            width: Math.abs(draft.x - draft.startX),
            height: Math.abs(draft.y - draft.startY),
            boxSizing: 'border-box',
            borderRadius: draft.tool === 'ellipse' ? '50%' : 0,
            background: draft.tool === 'redact' ? 'rgba(120,0,0,0.45)' : draft.tool === 'highlight' ? 'rgba(255,224,102,0.45)' : 'transparent',
            border: `2px dashed ${toolOptions.strokeColor}`,
            pointerEvents: 'none'
          }}
        />
      )}

      {/* A match can straddle a line break, so it carries one rect per
          text run it covers - highlight each rather than one box spanning
          the gap between them. */}
      {(doc.search.matches || [])
        .map((m, i) => ({ ...m, i }))
        .filter((m) => m.pageNumber === pageIndex + 1)
        .flatMap((m) =>
          (m.rects || [m.rect]).map((rect, j) => {
            const screenRect = storageRectToScreen(pdfPage, liveViewport, rect);
            return (
              <div
                key={`${m.i}-${j}`}
                className={`search-highlight ${m.i === doc.search.activeIndex ? 'active' : ''}`}
                style={{ left: screenRect.x, top: screenRect.y, width: screenRect.w, height: screenRect.h, pointerEvents: 'none' }}
              />
            );
          })
        )}
    </div>
  );
}

function BoxShape({ ann, pdfPage, liveViewport, selected, editing, onStartEdit, onStopEdit, onSelect, onChange, interactive }) {
  const screenRect = storageRectToScreen(pdfPage, liveViewport, ann);
  // Font sizes/stroke widths on an annotation are stored in real PDF
  // points (that's what gets baked into the saved file, always correct
  // regardless of zoom). The screen box itself is already zoom-scaled via
  // storageRectToScreen above, so anything measured in points has to be
  // scaled the same way for the live preview to match what gets saved -
  // otherwise text/borders only look right at whatever zoom level happens
  // to make points and CSS pixels line up 1:1.
  const zoomScale = liveViewport.scale;

  const handleDragStop = (e, d) => {
    const newStorage = screenRectToStorage(pdfPage, liveViewport, { x: d.x, y: d.y, w: screenRect.w, h: screenRect.h });
    onChange({ x: newStorage.x, y: newStorage.y }, true);
  };
  const handleResizeStop = (e, dir, ref, delta, position) => {
    const newScreenRect = { x: position.x, y: position.y, w: ref.offsetWidth, h: ref.offsetHeight };
    const newStorage = screenRectToStorage(pdfPage, liveViewport, newScreenRect);
    onChange(newStorage, true);
  };

  let content = null;
  if (ann.type === 'text') {
    content = editing ? (
      <textarea
        autoFocus
        className="field"
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          fontFamily: ann.fontFamily,
          fontWeight: ann.bold ? 'bold' : 'normal',
          fontStyle: ann.italic ? 'italic' : 'normal',
          fontSize: ann.fontSize * zoomScale,
          lineHeight: 1.25,
          color: ann.color,
          textAlign: ann.align,
          border: '1px solid var(--accent)',
          background: ann.coverRect ? ann.coverColor : 'rgba(255,255,255,0.9)'
        }}
        defaultValue={ann.text}
        onBlur={(e) => {
          onChange({ text: e.target.value }, true);
          onStopEdit();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    ) : (
      <div
        style={{
          width: '100%',
          height: '100%',
          fontFamily: ann.fontFamily,
          fontWeight: ann.bold ? 'bold' : 'normal',
          fontStyle: ann.italic ? 'italic' : 'normal',
          fontSize: ann.fontSize * zoomScale,
          lineHeight: 1.25,
          color: ann.color,
          textAlign: ann.align,
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          outline: selected ? '1px solid var(--accent)' : 'none',
          background: ann.coverRect ? ann.coverColor : 'transparent'
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit();
        }}
      >
        {ann.text}
      </div>
    );
  } else if (ann.type === 'image' || ann.type === 'signature') {
    content = <img src={ann.src} alt="" draggable={false} style={{ width: '100%', height: '100%', outline: selected ? '1px solid var(--accent)' : 'none' }} />;
  } else if (ann.type === 'rect' || ann.type === 'ellipse') {
    content = (
      <div
        style={{
          width: '100%',
          height: '100%',
          // border-box so the stroke sits inside the box, matching the
          // inset the save path applies (see shapeGeometry.insetForStroke).
          boxSizing: 'border-box',
          borderRadius: ann.type === 'ellipse' ? '50%' : 0,
          border: `${Math.max(1, ann.strokeWidth * zoomScale)}px solid ${ann.strokeColor}`,
          background: ann.fillColor ? hexToRgba(ann.fillColor, ann.fillOpacity ?? DEFAULT_FILL_OPACITY) : 'transparent'
        }}
      />
    );
  } else if (ann.type === 'highlight') {
    content = <div style={{ width: '100%', height: '100%', background: hexToRgba(ann.color, ann.opacity ?? 0.4) }} />;
  } else if (ann.type === 'redact') {
    content = (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'rgba(120,0,0,0.5)',
          border: '1px dashed #ff8080',
          color: '#fff',
          fontSize: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        REDACT
      </div>
    );
  } else if (ann.type === 'formfield') {
    content = (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          borderRadius: 4,
          border: '1.5px dashed var(--accent-line)',
          background: 'var(--accent-soft)'
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: -10,
            left: 6,
            padding: '2px 6px',
            borderRadius: 5,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontSize: 9.5,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}
        >
          {FIELD_TYPE_LABELS[ann.fieldType] || 'Field'} · {ann.name}
        </span>
      </div>
    );
  }

  return (
    <Rnd
      size={{ width: screenRect.w, height: screenRect.h }}
      position={{ x: screenRect.x, y: screenRect.y }}
      disableDragging={!interactive}
      enableResizing={interactive}
      bounds="parent"
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      onMouseDown={(e) => {
        // Only claim the click when a drawing tool isn't active - otherwise
        // an existing object silently blocks the user from starting a new
        // shape/text box on top of it.
        if (!interactive) return;
        e.stopPropagation();
        onSelect();
      }}
      style={{ zIndex: selected ? 5 : 1 }}
    >
      {content}
    </Rnd>
  );
}

function StrokeShape({ ann, pdfPage, liveViewport, selected, onSelect, onChange, interactive }) {
  const zoomScale = liveViewport.scale; // see BoxShape - strokeWidth is stored in PDF points
  if (ann.type === 'pen') {
    const screenPts = ann.points.map((p) => storagePointToScreen(pdfPage, liveViewport, p.x, p.y));
    const pointsStr = screenPts.map(([x, y]) => `${x},${y}`).join(' ');
    const onMouseDown = (e) => {
      if (!interactive) return;
      e.stopPropagation();
      onSelect();
      const start = { x: e.clientX, y: e.clientY };
      const startPoints = ann.points.map((p) => ({ ...p }));
      const onMove = (ev) => {
        const [dx, dy] = screenDeltaToStorage(pdfPage, liveViewport, ev.clientX - start.x, ev.clientY - start.y);
        const newPoints = startPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        onChange({ points: newPoints }, false);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    return (
      <polyline
        points={pointsStr}
        fill="none"
        stroke={ann.strokeColor}
        strokeWidth={(ann.strokeWidth + (selected ? 2 : 0)) * zoomScale}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: interactive ? 'stroke' : 'none', cursor: 'move' }}
        onMouseDown={onMouseDown}
      />
    );
  }

  // line / arrow
  const [x1, y1] = storagePointToScreen(pdfPage, liveViewport, ann.x1, ann.y1);
  const [x2, y2] = storagePointToScreen(pdfPage, liveViewport, ann.x2, ann.y2);
  // Arrowheads are drawn as an explicit polygon rather than an SVG
  // <marker>: markers scale with `markerUnits="strokeWidth"` (so the head
  // ballooned on thick strokes) and every arrow on the page reused the
  // same marker id, so they all picked up the first arrow's color. This
  // also shares arrowGeometry() with the save path, so what you see is
  // what gets written.
  const geo = ann.type === 'arrow' ? arrowGeometry(x1, y1, x2, y2, ann.strokeWidth * zoomScale) : null;
  const shaftEnd = geo ? [geo.shaft.x2, geo.shaft.y2] : [x2, y2];

  const makeEndpointDrag = (whichX, whichY) => (e) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect();
    const onMove = (ev) => {
      const svg = e.target.ownerSVGElement;
      const rect = svg.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const [px, py] = screenPointToStorage(pdfPage, liveViewport, sx, sy);
      onChange({ [whichX]: px, [whichY]: py }, false);
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onMove(ev);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onLineDrag = (e) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect();
    const start = { x: e.clientX, y: e.clientY };
    const p1 = { x: ann.x1, y: ann.y1 };
    const p2 = { x: ann.x2, y: ann.y2 };
    const onMove = (ev) => {
      const [dx, dy] = screenDeltaToStorage(pdfPage, liveViewport, ev.clientX - start.x, ev.clientY - start.y);
      onChange({ x1: p1.x + dx, y1: p1.y + dy, x2: p2.x + dx, y2: p2.y + dy }, false);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(14, ann.strokeWidth * zoomScale + 10)} style={{ pointerEvents: interactive ? 'stroke' : 'none', cursor: 'move' }} onMouseDown={onLineDrag} />
      <line x1={x1} y1={y1} x2={shaftEnd[0]} y2={shaftEnd[1]} stroke={ann.strokeColor} strokeWidth={(ann.strokeWidth + (selected ? 1.5 : 0)) * zoomScale} style={{ pointerEvents: 'none' }} />
      {geo && geo.head.length === 3 && (
        <polygon points={pointsAttr(geo.head)} fill={ann.strokeColor} style={{ pointerEvents: 'none' }} />
      )}
      {selected && interactive && (
        <>
          <circle cx={x1} cy={y1} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'grab' }} onMouseDown={makeEndpointDrag('x1', 'y1')} />
          <circle cx={x2} cy={y2} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'grab' }} onMouseDown={makeEndpointDrag('x2', 'y2')} />
        </>
      )}
    </g>
  );
}

function hexToRgba(hex, opacity) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#000000');
  if (!m) return `rgba(0,0,0,${opacity})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${opacity})`;
}
