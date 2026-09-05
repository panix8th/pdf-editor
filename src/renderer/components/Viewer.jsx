import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore, getResource } from '../state/store';
import AnnotationLayer from './AnnotationLayer.jsx';
import { fakePage } from '../pdf/viewportMath';
import {
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
  IconSinglePage,
  IconContinuous,
  IconRotateView
} from './Icons.jsx';

const TOOL_META = {
  select: { label: 'Select', icon: IconSelect },
  text: { label: 'Text', icon: IconText },
  image: { label: 'Image', icon: IconImage },
  highlight: { label: 'Highlight', icon: IconHighlight },
  rect: { label: 'Rectangle', icon: IconRect },
  ellipse: { label: 'Ellipse', icon: IconEllipse },
  line: { label: 'Line', icon: IconLine },
  arrow: { label: 'Arrow', icon: IconArrow },
  pen: { label: 'Pen', icon: IconPen },
  redact: { label: 'Redact', icon: IconRedact }
};

function resolvePdfjsDoc(resources, page) {
  if (page.source === 'self') return resources.pdfjsDoc;
  if (page.source === 'blank') return null;
  return resources.externalPdfjsDocs?.get(page.source) || null;
}

const PADDING = 24;

export default function Viewer() {
  const doc = useStore((s) => s.documents[s.activeId]);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const setViewMode = useStore((s) => s.setViewMode);
  const rotatePage = useStore((s) => s.rotatePage);
  const wrapRef = useRef(null);
  const pageRefs = useRef({});
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll to a requested page (from thumbnail / outline / search click).
  useEffect(() => {
    if (!doc?.scrollTarget) return;
    const el = pageRefs.current[doc.scrollTarget.index];
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [doc?.scrollTarget]);

  // Track which page is currently most visible to keep the page-jump box in sync.
  const onScroll = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !doc) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    let best = 1;
    let bestDist = Infinity;
    doc.pages.forEach((p, i) => {
      const el = pageRefs.current[i];
      if (!el) return;
      const dist = Math.abs(el.getBoundingClientRect().top - wrapTop);
      if (dist < bestDist) {
        bestDist = dist;
        best = i + 1;
      }
    });
    if (best !== doc.currentPage) setCurrentPage(doc.id, best);
  }, [doc, setCurrentPage]);

  if (!doc) return null;

  const pagesToShow = doc.viewMode === 'single' ? [doc.pages[doc.currentPage - 1]].filter(Boolean) : doc.pages;
  const currentPageKey = doc.pages[doc.currentPage - 1]?.key;
  const toolMeta = TOOL_META[doc.tool] || TOOL_META.select;
  const ToolIcon = toolMeta.icon;

  return (
    <div className="viewer-wrap">
      <div className="viewer-scroll" ref={wrapRef} onScroll={onScroll}>
        <div className="viewer-pages" style={{ paddingTop: PADDING, paddingBottom: PADDING + 180 }}>
          {pagesToShow.map((p) => {
            const index = doc.pages.indexOf(p);
            return (
              <PageView
                key={p.key}
                doc={doc}
                page={p}
                index={index}
                containerSize={containerSize}
                registerRef={(el) => (pageRefs.current[index] = el)}
              />
            );
          })}
        </div>
      </div>

      <div className="floating-dock">
        <div className="dock-tool-pill">
          <ToolIcon />
          <span>{toolMeta.label}</span>
        </div>
        <div className="dock-divider" />
        <div
          className={`dock-btn ${doc.viewMode === 'single' ? 'active' : ''}`}
          title="Single page"
          onClick={() => setViewMode(doc.id, 'single')}
        >
          <IconSinglePage />
        </div>
        <div
          className={`dock-btn ${doc.viewMode === 'continuous' ? 'active' : ''}`}
          title="Continuous"
          onClick={() => setViewMode(doc.id, 'continuous')}
        >
          <IconContinuous />
        </div>
        <div className="dock-btn" title="Rotate current page" onClick={() => currentPageKey && rotatePage(doc.id, currentPageKey, 90)}>
          <IconRotateView />
        </div>
      </div>
    </div>
  );
}

function PageView({ doc, page, index, containerSize, registerRef }) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(index < 2);
  const [pdfPage, setPdfPage] = useState(null);

  useEffect(() => {
    registerRef(shellRef.current);
  });

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setVisible(true), {
      rootMargin: '600px 0px'
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const baseSize = useMemo(() => {
    const swapped = page.rotation % 180 !== 0;
    return { w: swapped ? page.height : page.width, h: swapped ? page.width : page.height };
  }, [page.rotation, page.width, page.height]);

  const scale = useMemo(() => {
    const availW = containerSize.width - PADDING * 2;
    const availH = containerSize.height - PADDING * 2;
    if (doc.fitMode === 'width') return Math.max(0.1, availW / baseSize.w);
    if (doc.fitMode === 'page') return Math.max(0.1, Math.min(availW / baseSize.w, availH / baseSize.h));
    return doc.zoom;
  }, [doc.fitMode, doc.zoom, containerSize, baseSize]);

  const pxW = Math.round(baseSize.w * scale);
  const pxH = Math.round(baseSize.h * scale);

  useEffect(() => {
    if (!visible) return;
    if (page.source === 'blank') {
      setPdfPage(fakePage(page.width, page.height));
      return;
    }
    let cancelled = false;
    (async () => {
      const resources = getResource(doc.id);
      const pdfjsDoc = resolvePdfjsDoc(resources, page);
      if (!pdfjsDoc) return;
      const pg = await pdfjsDoc.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      setPdfPage(pg);
    })();
    return () => {
      cancelled = true;
    };
    // The fields are listed individually rather than depending on `page`:
    // its identity changes on every rotation, which would needlessly
    // re-fetch a page object that hasn't changed.
  }, [visible, doc.id, page.sourceIndex, page.source, page.width, page.height]);

  useEffect(() => {
    if (!pdfPage || pdfPage.isFake || !canvasRef.current) return;
    // Render at the display's real pixel density, not CSS pixels: on a
    // HiDPI screen (or Windows' near-universal 125/150% scaling) a canvas
    // backing store sized in CSS pixels gets upscaled by the compositor,
    // which is exactly why PDF text looks soft in a lot of viewers.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = pdfPage.getViewport({ scale: scale * dpr, rotation: page.rotation });
    const canvas = canvasRef.current;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
    task.promise.catch(() => {
      /* superseded by a newer render - see the cleanup below */
    });
    return () => {
      // Actually cancel, don't just ignore the result. pdf.js refuses to
      // run two renders against one canvas ("Cannot use the same canvas
      // during multiple render operations"), so zooming faster than a page
      // renders used to leave it blank or half-painted.
      task.cancel();
    };
  }, [pdfPage, scale, page.rotation]);

  return (
    <div ref={shellRef} data-page-index={index}>
      <div className="page-shell" style={{ width: pxW, height: pxH }}>
        {pdfPage && !pdfPage.isFake ? (
          <canvas ref={canvasRef} style={{ width: pxW, height: pxH }} />
        ) : (
          <div style={{ width: pxW, height: pxH, background: '#fff' }} />
        )}
        {pdfPage && (
          <AnnotationLayer doc={doc} page={page} pageIndex={index} pdfPage={pdfPage} scale={scale} rotation={page.rotation} pxW={pxW} pxH={pxH} />
        )}
      </div>
      <div className="page-label">
        {index + 1} / {doc.pageCount}
      </div>
    </div>
  );
}
