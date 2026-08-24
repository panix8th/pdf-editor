import React, { useEffect, useRef, useState } from 'react';
import { useStore, getResource } from '../state/store';
import { searchDocument } from '../pdf/textSearch';
import { IconPages, IconOutline, IconSearch, IconForms, IconLayers } from './Icons.jsx';
import { FIELD_TYPE_LABELS } from '../pdf/formFields';

const TABS = [
  { id: 'thumbnails', label: 'Pages', icon: IconPages },
  { id: 'outline', label: 'Outline', icon: IconOutline },
  { id: 'search', label: 'Search', icon: IconSearch },
  { id: 'forms', label: 'Forms', icon: IconForms },
  { id: 'layers', label: 'Layers', icon: IconLayers }
];

const TYPE_LABELS = {
  text: 'Text',
  image: 'Image',
  signature: 'Signature',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  pen: 'Pen',
  highlight: 'Highlight',
  redact: 'Redaction',
  formfield: 'Form Field'
};

const MIN_PANEL_W = 200;
const MAX_PANEL_W = 420;

function panelCount(doc, tab) {
  if (!doc) return null;
  if (tab === 'thumbnails') return `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`;
  if (tab === 'outline') return `${doc.outline?.length || 0}`;
  if (tab === 'search') return doc.search.matches.length ? `${doc.search.matches.length}` : null;
  if (tab === 'forms') {
    let newFieldCount = 0;
    for (const pageKey of Object.keys(doc.annotations)) {
      newFieldCount += doc.annotations[pageKey].filter((a) => a.type === 'formfield').length;
    }
    const total = (doc.formFields?.length || 0) + newFieldCount;
    return total ? `${total}` : null;
  }
  if (tab === 'layers') {
    const page = doc.pages[doc.currentPage - 1];
    const count = page ? (doc.annotations[page.key] || []).length : 0;
    return `${count}`;
  }
  return null;
}

export default function Sidebar() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const doc = useStore((s) => s.documents[s.activeId]);
  const insertBlankPage = useStore((s) => s.insertBlankPage);
  const rotatePage = useStore((s) => s.rotatePage);
  const deletePage = useStore((s) => s.deletePage);

  const [panelWidth, setPanelWidth] = useState(236);
  const resizing = useRef(false);

  const onRailClick = (tabId) => {
    if (sidebarTab === tabId && sidebarOpen) toggleSidebar();
    else setSidebarTab(tabId);
  };

  const onResizerDown = (e) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev) => {
      const next = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, startW + (ev.clientX - startX)));
      setPanelWidth(next);
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const currentPageKey = doc?.pages[doc.currentPage - 1]?.key;
  const activeTab = TABS.find((t) => t.id === sidebarTab);
  const count = panelCount(doc, sidebarTab);

  return (
    <>
      <div className="icon-rail">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              className={`rail-btn ${sidebarTab === t.id && sidebarOpen ? 'active' : ''}`}
              title={t.label}
              onClick={() => onRailClick(t.id)}
            >
              <Icon />
            </div>
          );
        })}
        <div className="rail-spacer" />
      </div>

      {sidebarOpen && (
        <div className="side-panel" style={{ width: panelWidth }}>
          <div className="panel-header">
            <span className="panel-title">{activeTab.label}</span>
            {count != null && <span className="panel-count">{count}</span>}
          </div>
          <div className="panel-body">
            {!doc && <div className="outline-empty">Open a PDF to see its pages.</div>}
            {doc && sidebarTab === 'thumbnails' && <Thumbnails doc={doc} />}
            {doc && sidebarTab === 'outline' && <Outline doc={doc} />}
            {doc && sidebarTab === 'search' && <SearchPanel doc={doc} />}
            {doc && sidebarTab === 'forms' && <FormsPanel doc={doc} />}
            {doc && sidebarTab === 'layers' && <LayersPanel doc={doc} />}
          </div>
          {doc && sidebarTab === 'thumbnails' && (
            <div className="panel-footer">
              <div className="panel-footer-btn" onClick={() => insertBlankPage(doc.id, doc.currentPage - 1)}>
                Insert
              </div>
              <div className="panel-footer-btn" onClick={() => currentPageKey && rotatePage(doc.id, currentPageKey, 90)}>
                Rotate
              </div>
              <div className="panel-footer-btn danger" onClick={() => currentPageKey && deletePage(doc.id, currentPageKey)}>
                Delete
              </div>
            </div>
          )}
          <div className="rail-resizer" onMouseDown={onResizerDown} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Thumbnails({ doc }) {
  const scrollToPage = useStore((s) => s.scrollToPage);
  const reorderPages = useStore((s) => s.reorderPages);
  const deletePage = useStore((s) => s.deletePage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const rotatePage = useStore((s) => s.rotatePage);
  const dragIndex = useRef(null);

  const onDragStart = (i) => (e) => {
    dragIndex.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (i) => (e) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === i) return;
    const pages = [...doc.pages];
    const [moved] = pages.splice(from, 1);
    pages.splice(i, 0, moved);
    reorderPages(doc.id, pages);
    dragIndex.current = null;
  };

  return (
    <div>
      {doc.pages.map((p, i) => (
        <div
          key={p.key}
          className={`thumb ${doc.currentPage === i + 1 ? 'active' : ''}`}
          draggable
          onDragStart={onDragStart(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop(i)}
          onClick={() => scrollToPage(doc.id, i)}
        >
          <div className="thumb-frame">
            <PageThumb doc={doc} page={p} />
          </div>
          <div className="thumb-label">
            <span>Page {i + 1}</span>
          </div>
          <div className="thumb-actions">
            <button title="Rotate left" onClick={(e) => { e.stopPropagation(); rotatePage(doc.id, p.key, -90); }}>
              ⟲
            </button>
            <button title="Rotate right" onClick={(e) => { e.stopPropagation(); rotatePage(doc.id, p.key, 90); }}>
              ⟳
            </button>
            <button title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicatePage(doc.id, p.key); }}>
              ⧉
            </button>
            <button title="Delete" onClick={(e) => { e.stopPropagation(); deletePage(doc.id, p.key); }}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PageThumb({ doc, page }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible(true);
      },
      { root: el.closest('.sidebar-body'), rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || page.source !== 'self') return;
    let cancelled = false;
    (async () => {
      const resources = getResource(doc.id);
      const pdfjsDoc = resources?.pdfjsDoc;
      if (!pdfjsDoc) return;
      const pdfPage = await pdfjsDoc.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      const targetW = 190;
      const baseViewport = pdfPage.getViewport({ scale: 1, rotation: page.rotation });
      const scale = targetW / baseViewport.width;
      const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, doc.id, page.sourceIndex, page.rotation, page.source]);

  return (
    <div ref={ref}>
      {page.source === 'self' ? (
        <canvas ref={canvasRef} />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: `${page.width} / ${page.height}`,
            background: '#fff',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#999',
            fontSize: 11
          }}
        >
          {page.source === 'blank' ? 'Blank page' : 'Inserted page'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Outline({ doc }) {
  const scrollToPage = useStore((s) => s.scrollToPage);

  function renderItems(items, depth) {
    return items.map((item, i) => (
      <div key={i}>
        <div
          className="outline-item"
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => item.pageIndex !== null && scrollToPage(doc.id, item.pageIndex)}
        >
          {item.title}
        </div>
        {item.items && item.items.length > 0 && renderItems(item.items, depth + 1)}
      </div>
    ));
  }

  if (!doc.outline || doc.outline.length === 0) {
    return <div className="outline-empty">This document has no bookmarks.</div>;
  }
  return <div>{renderItems(doc.outline, 0)}</div>;
}

// ---------------------------------------------------------------------------

function SearchPanel({ doc }) {
  const setSearch = useStore((s) => s.setSearch);
  const scrollToPage = useStore((s) => s.scrollToPage);
  const [query, setQuery] = useState(doc.search.query);
  const [loading, setLoading] = useState(false);

  const runSearch = async () => {
    if (!query.trim()) {
      setSearch(doc.id, { query: '', matches: [], activeIndex: -1 });
      return;
    }
    setLoading(true);
    const resources = getResource(doc.id);
    const matches = await searchDocument(resources.pdfjsDoc, query);
    setSearch(doc.id, { query, matches, activeIndex: matches.length ? 0 : -1 });
    setLoading(false);
    if (matches.length) scrollToPage(doc.id, matches[0].pageNumber - 1);
  };

  const goTo = (idx) => {
    const m = doc.search.matches[idx];
    if (!m) return;
    setSearch(doc.id, { activeIndex: idx });
    scrollToPage(doc.id, m.pageNumber - 1);
  };

  return (
    <div>
      <div className="search-box">
        <input
          className="field"
          placeholder="Search text..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button className="btn" onClick={runSearch}>
          Go
        </button>
      </div>
      {loading && <div className="hint">Searching...</div>}
      {!loading && doc.search.matches.length > 0 && (
        <div className="search-nav">
          <button className="btn btn-icon" onClick={() => goTo(Math.max(0, doc.search.activeIndex - 1))}>
            ‹
          </button>
          <span>
            {doc.search.activeIndex + 1} / {doc.search.matches.length}
          </span>
          <button className="btn btn-icon" onClick={() => goTo(Math.min(doc.search.matches.length - 1, doc.search.activeIndex + 1))}>
            ›
          </button>
        </div>
      )}
      {!loading && doc.search.query && doc.search.matches.length === 0 && <div className="hint">No matches found.</div>}
      {doc.search.matches.map((m, i) => (
        <div key={i} className={`search-result ${i === doc.search.activeIndex ? 'active' : ''}`} onClick={() => goTo(i)}>
          <strong>p.{m.pageNumber}</strong> {m.snippet.slice(0, 60)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FormsPanel({ doc }) {
  const updateDoc = useStore((s) => s.updateDoc);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const markDirty = useStore((s) => s.markDirty);

  // Fields already in the opened PDF (doc.formFields) and fields added
  // this session via the Field tool (formfield annotations, not yet baked
  // into a real AcroForm field until Save) are both listed here so new
  // ones can be test-filled immediately instead of only after a save +
  // reopen round-trip.
  const newFields = [];
  for (const pageKey of Object.keys(doc.annotations)) {
    for (const ann of doc.annotations[pageKey]) {
      if (ann.type === 'formfield') newFields.push({ pageKey, ann });
    }
  }

  if (doc.editingUnsupported) {
    return <div className="forms-empty">Form filling isn't available for this file's encryption type.</div>;
  }
  if ((!doc.formFields || doc.formFields.length === 0) && newFields.length === 0) {
    return <div className="forms-empty">No fillable form fields yet. Detected fields from the PDF appear here, or add your own with the Field tool.</div>;
  }

  const setValue = (name, value) => {
    const formValues = doc.formValues.map((f) => (f.name === name ? { ...f, value } : f));
    updateDoc(doc.id, { formValues });
    markDirty(doc.id);
  };

  return (
    <div>
      {doc.formFields.map((f) => {
        const current = doc.formValues.find((v) => v.name === f.name)?.value;
        return (
          <div key={f.name} className="form-field">
            <label>
              {f.name} <span style={{ opacity: 0.6 }}>({f.type.replace('PDF', '').replace('Field', '')})</span>
            </label>
            {f.type === 'PDFTextField' && (
              <input className="field" value={current || ''} onChange={(e) => setValue(f.name, e.target.value)} />
            )}
            {f.type === 'PDFCheckBox' && (
              <input type="checkbox" checked={!!current} onChange={(e) => setValue(f.name, e.target.checked)} />
            )}
            {(f.type === 'PDFDropdown' || f.type === 'PDFRadioGroup') && (
              <select className="field" value={current || ''} onChange={(e) => setValue(f.name, e.target.value)}>
                <option value="" />
                {(f.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {newFields.map(({ pageKey, ann }) => (
        <div key={ann.id} className="form-field">
          <label>
            {ann.name} <span style={{ opacity: 0.6 }}>({FIELD_TYPE_LABELS[ann.fieldType] || ann.fieldType}, new)</span>
          </label>
          {ann.fieldType === 'text' && (
            <input
              className="field"
              value={ann.value || ''}
              onChange={(e) => updateAnnotation(doc.id, pageKey, ann.id, { value: e.target.value }, { record: false })}
            />
          )}
          {ann.fieldType === 'checkbox' && (
            <input
              type="checkbox"
              checked={!!ann.value}
              onChange={(e) => updateAnnotation(doc.id, pageKey, ann.id, { value: e.target.checked }, { record: false })}
            />
          )}
          {ann.fieldType === 'dropdown' && (
            <select
              className="field"
              value={ann.value || ''}
              onChange={(e) => updateAnnotation(doc.id, pageKey, ann.id, { value: e.target.value }, { record: false })}
            >
              <option value="" />
              {(ann.options || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      <div className="hint">Field values are baked in the next time you save.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Shows the current page's objects top-to-bottom (front layer first, like
 * a typical design tool), draggable to reorder - array order is paint
 * order, so this is a direct "what's over what" control. */
function LayersPanel({ doc }) {
  const selectObject = useStore((s) => s.selectObject);
  const deleteAnnotation = useStore((s) => s.deleteAnnotation);
  const reorderAnnotations = useStore((s) => s.reorderAnnotations);
  const moveAnnotationLayer = useStore((s) => s.moveAnnotationLayer);
  const dragIndex = useRef(null);

  const page = doc.pages[doc.currentPage - 1];
  const pageKey = page?.key;
  const list = pageKey ? doc.annotations[pageKey] || [] : [];
  const frontToBack = [...list].reverse();

  if (!pageKey) return <div className="outline-empty">No page selected.</div>;
  if (list.length === 0) return <div className="outline-empty">No objects on this page yet. Add text, shapes, or images to see them here.</div>;

  const onDragStart = (frontIdx) => (e) => {
    dragIndex.current = frontIdx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (frontIdx) => (e) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === frontIdx) return;
    const reordered = [...frontToBack];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(frontIdx, 0, moved);
    reorderAnnotations(doc.id, pageKey, [...reordered].reverse());
    dragIndex.current = null;
  };

  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>
        Top of the list is drawn on top. Drag to reorder.
      </div>
      {frontToBack.map((a, i) => {
        const isSelected = doc.selection?.pageKey === pageKey && doc.selection?.objectId === a.id;
        return (
          <div
            key={a.id}
            className={`layer-row ${isSelected ? 'active' : ''}`}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop(i)}
            onClick={() => selectObject(doc.id, pageKey, a.id)}
          >
            <span className="layer-row-label">
              {TYPE_LABELS[a.type] || a.type}
              {a.type === 'text' && a.text ? `: ${a.text.slice(0, 18)}` : ''}
            </span>
            <div className="layer-row-actions">
              <button title="Bring to front" onClick={(e) => { e.stopPropagation(); moveAnnotationLayer(doc.id, pageKey, a.id, 'front'); }}>⤒</button>
              <button title="Move forward" onClick={(e) => { e.stopPropagation(); moveAnnotationLayer(doc.id, pageKey, a.id, 'forward'); }}>↑</button>
              <button title="Move backward" onClick={(e) => { e.stopPropagation(); moveAnnotationLayer(doc.id, pageKey, a.id, 'backward'); }}>↓</button>
              <button title="Send to back" onClick={(e) => { e.stopPropagation(); moveAnnotationLayer(doc.id, pageKey, a.id, 'back'); }}>⤓</button>
              <button title="Delete" onClick={(e) => { e.stopPropagation(); deleteAnnotation(doc.id, pageKey, a.id); }}>✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
