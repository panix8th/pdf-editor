import React, { useMemo, useRef, useState, useCallback } from 'react';
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

const BOX_TOOLS = new Set(['rect', 'highlight', 'redact']);
const LINE_TOOLS = new Set(['line', 'arrow']);

export default function AnnotationLayer({ doc, page, pageIndex, pdfPage, scale, rotation, pxW, pxH }) {
  const overlayRef = useRef(null);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const deleteAnnotation = useStore((s) => s.deleteAnnotation);
  const selectObject = useStore((s) => s.selectObject);
  const setTool = useStore((s) => s.setTool);
  const showToast = useStore((s) => s.showToast);

  const annotations = doc.annotations[page.key] || [];
  const tool = doc.tool;
  const toolOptions = doc.toolOptions;
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const liveViewport = useMemo(() => pdfPage.getViewport({ scale, rotation }), [pdfPage, scale, rotation]);

  const isSelected = (id) => doc.selection && doc.selection.pageKey === page.key && doc.selection.objectId === id;

  const getOffset = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

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
    if (e.target !== overlayRef.current) return; // clicks on child objects handle themselves
    const { x, y } = getOffset(e);

    if (tool === 'select') {
      selectObject(doc.id, page.key, null);
      return;
    }

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
      setEditingId(ann.id);
      return;
    }

    if (tool === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const storagePt = screenPointToStorage(pdfPage, liveViewport, x, y);
            const w = 180;
            const h = w * (img.height / img.width);
            addAnnotation(doc.id, page.key, {
              id: uuid(),
              type: 'image',
              x: storagePt[0],
              y: storagePt[1],
              w,
              h,
              src: reader.result,
              format: file.type.includes('png') ? 'png' : 'jpg'
            });
            setTool(doc.id, 'select');
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
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
        if (tool === 'rect') {
          commitNewShape('rect', { x: Math.min(x, ex), y: Math.min(y, ey), w: Math.abs(ex - x), h: Math.abs(ey - y) }, {
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
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onMouseDown={onOverlayMouseDown}
    >
      <svg width={pxW} height={pxH} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {annotations
          .filter((a) => a.type === 'line' || a.type === 'arrow' || a.type === 'pen')
          .map((a) => (
            <StrokeShape
              key={a.id}
              ann={a}
              pdfPage={pdfPage}
              liveViewport={liveViewport}
              selected={isSelected(a.id)}
              onSelect={() => tool === 'select' && selectObject(doc.id, page.key, a.id)}
              onChange={(patch, record) => updateAnnotation(doc.id, page.key, a.id, patch, { record })}
              interactive={tool === 'select'}
            />
          ))}
        {draft && (draft.tool === 'line' || draft.tool === 'arrow') && (
          <line x1={draft.startX} y1={draft.startY} x2={draft.x} y2={draft.y} stroke={toolOptions.strokeColor} strokeWidth={toolOptions.strokeWidth} strokeDasharray="4 3" />
        )}
        {draft && draft.tool === 'pen' && (
          <polyline
            points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={toolOptions.strokeColor}
            strokeWidth={toolOptions.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {annotations
        .filter((a) => BOX_TOOLS.has(a.type) || a.type === 'text' || a.type === 'image' || a.type === 'signature')
        .map((a) => (
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
        ))}

      {draft && BOX_TOOLS.has(draft.tool) && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(draft.startX, draft.x),
            top: Math.min(draft.startY, draft.y),
            width: Math.abs(draft.x - draft.startX),
            height: Math.abs(draft.y - draft.startY),
            background: draft.tool === 'redact' ? 'rgba(120,0,0,0.45)' : draft.tool === 'highlight' ? 'rgba(255,224,102,0.45)' : 'transparent',
            border: `2px dashed ${toolOptions.strokeColor}`,
            pointerEvents: 'none'
          }}
        />
      )}

      {(doc.search.matches || [])
        .map((m, i) => ({ ...m, i }))
        .filter((m) => m.pageNumber === pageIndex + 1)
        .map((m) => {
          const screenRect = storageRectToScreen(pdfPage, liveViewport, m.rect);
          return (
            <div
              key={m.i}
              className={`search-highlight ${m.i === doc.search.activeIndex ? 'active' : ''}`}
              style={{ left: screenRect.x, top: screenRect.y, width: screenRect.w, height: screenRect.h, pointerEvents: 'none' }}
            />
          );
        })}
    </div>
  );
}

function BoxShape({ ann, pdfPage, liveViewport, selected, editing, onStartEdit, onStopEdit, onSelect, onChange, interactive }) {
  const screenRect = storageRectToScreen(pdfPage, liveViewport, ann);

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
          fontSize: ann.fontSize,
          color: ann.color,
          textAlign: ann.align,
          border: '1px solid var(--accent)',
          background: 'rgba(255,255,255,0.9)'
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
          fontSize: ann.fontSize,
          color: ann.color,
          textAlign: ann.align,
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          outline: selected ? '1px solid var(--accent)' : 'none'
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
  } else if (ann.type === 'rect') {
    content = (
      <div
        style={{
          width: '100%',
          height: '100%',
          border: `${ann.strokeWidth}px solid ${ann.strokeColor}`,
          background: ann.fillColor ? hexToRgba(ann.fillColor, ann.fillOpacity ?? 0.3) : 'transparent'
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
        e.stopPropagation();
        if (interactive) onSelect();
      }}
      style={{ zIndex: selected ? 5 : 1 }}
    >
      {content}
    </Rnd>
  );
}

function StrokeShape({ ann, pdfPage, liveViewport, selected, onSelect, onChange, interactive }) {
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
        strokeWidth={selected ? ann.strokeWidth + 2 : ann.strokeWidth}
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
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(14, ann.strokeWidth + 10)} style={{ pointerEvents: interactive ? 'stroke' : 'none', cursor: 'move' }} onMouseDown={onLineDrag} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.strokeColor} strokeWidth={selected ? ann.strokeWidth + 1.5 : ann.strokeWidth} markerEnd={ann.type === 'arrow' ? 'url(#arrowhead)' : undefined} style={{ pointerEvents: 'none' }} />
      {ann.type === 'arrow' && (
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={ann.strokeColor} />
          </marker>
        </defs>
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
