import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import pdfjsLib from './pdfjsSetup';
import { resolveStandardFont, isCustomFont } from './fonts';
import { storageRectToPdfLib } from './coords';

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export const PASSWORD_REQUIRED = 'PASSWORD_REQUIRED';

/**
 * Load a PDF with pdf.js (used for rendering, search, outline, and page
 * geometry). Throws { code: PASSWORD_REQUIRED } if the file needs a password
 * and none/an incorrect one was supplied.
 */
export async function openWithPdfJs(bytes, password) {
  const loadingTask = pdfjsLib.getDocument({
    // pdf.js may transfer/detach the underlying ArrayBuffer to its worker
    // for zero-copy performance, which would silently zero out `bytes` for
    // every other caller still holding a reference to it (this is exactly
    // what caused "No PDF header found" on save - pdf-lib got handed an
    // emptied buffer). Always hand pdf.js an independent copy.
    data: bytes.slice(),
    password: password || undefined,
    // Fully offline: never let pdf.js fetch external resources (fonts, ICC
    // profiles, etc.) over the network.
    isEvalSupported: false,
    disableFontFace: false
  });
  try {
    const doc = await loadingTask.promise;
    return doc;
  } catch (err) {
    if (err && (err.name === 'PasswordException')) {
      const e = new Error('This PDF is password protected.');
      e.code = PASSWORD_REQUIRED;
      throw e;
    }
    throw err;
  }
}

export async function buildPageMeta(pdfjsDoc) {
  const pages = [];
  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    pages.push({
      key: `p-${i}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'self',
      sourceIndex: i - 1,
      rotation: page.rotate || 0,
      width: viewport.width,
      height: viewport.height
    });
  }
  return pages;
}

async function resolveOutlineDest(pdfjsDoc, dest) {
  try {
    let explicitDest = dest;
    if (typeof dest === 'string') {
      explicitDest = await pdfjsDoc.getDestination(dest);
    }
    if (!explicitDest) return null;
    const pageIndex = await pdfjsDoc.getPageIndex(explicitDest[0]);
    return pageIndex;
  } catch {
    return null;
  }
}

export async function buildOutline(pdfjsDoc) {
  const raw = await pdfjsDoc.getOutline();
  if (!raw) return [];
  async function walk(items) {
    const out = [];
    for (const item of items) {
      const pageIndex = await resolveOutlineDest(pdfjsDoc, item.dest);
      out.push({
        title: item.title,
        pageIndex,
        items: item.items && item.items.length ? await walk(item.items) : []
      });
    }
    return out;
  }
  return walk(raw);
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export async function detectFormFields(originalBytes) {
  try {
    const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields().map((f) => {
      const type = f.constructor.name;
      const base = { name: f.getName(), type };
      try {
        if (type === 'PDFTextField') base.value = f.getText() || '';
        else if (type === 'PDFCheckBox') base.value = f.isChecked();
        else if (type === 'PDFRadioGroup') {
          base.value = f.getSelected() || '';
          base.options = f.getOptions();
        } else if (type === 'PDFDropdown') {
          base.value = f.getSelected()[0] || '';
          base.options = f.getOptions();
        } else if (type === 'PDFOptionList') {
          base.value = f.getSelected();
          base.options = f.getOptions();
        }
      } catch {
        base.value = null;
      }
      return base;
    });
    return fields;
  } catch {
    return [];
  }
}

function applyFormValues(pdfDoc, formValues) {
  if (!formValues || formValues.length === 0) return;
  const form = pdfDoc.getForm();
  for (const fv of formValues) {
    try {
      const field = form.getField(fv.name);
      const type = field.constructor.name;
      if (type === 'PDFTextField') field.setText(fv.value || '');
      else if (type === 'PDFCheckBox') (fv.value ? field.check() : field.uncheck());
      else if (type === 'PDFRadioGroup') field.select(fv.value);
      else if (type === 'PDFDropdown') field.select(fv.value);
      else if (type === 'PDFOptionList') field.select(fv.value);
    } catch {
      // Unknown/removed field - skip rather than fail the whole save.
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#000000');
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

function wrapText(font, text, fontSize, maxWidth) {
  const lines = [];
  const paragraphs = String(text ?? '').split('\n');
  for (const para of paragraphs) {
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

async function embedImageForDataUrl(outDoc, cache, dataUrl) {
  if (cache.has(dataUrl)) return cache.get(dataUrl);
  const isPng = dataUrl.startsWith('data:image/png');
  const base64 = dataUrl.split(',')[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const embedded = isPng ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);
  cache.set(dataUrl, embedded);
  return embedded;
}

async function getFontFor(ctx, ann) {
  const { outDoc, standardFontCache, customFonts, customFontCache } = ctx;
  if (ann.fontId && customFonts && customFonts.has(ann.fontId)) {
    if (customFontCache.has(ann.fontId)) return customFontCache.get(ann.fontId);
    const { bytes } = customFonts.get(ann.fontId);
    const embedded = await outDoc.embedFont(bytes, { subset: true });
    customFontCache.set(ann.fontId, embedded);
    return embedded;
  }
  const key = `${ann.fontFamily}-${ann.bold ? 'b' : ''}${ann.italic ? 'i' : ''}`;
  if (standardFontCache.has(key)) return standardFontCache.get(key);
  const std = resolveStandardFont(ann.fontFamily, ann.bold, ann.italic);
  const embedded = await outDoc.embedFont(std);
  standardFontCache.set(key, embedded);
  return embedded;
}

async function drawAnnotation(ctx, page, ann, pageHeight) {
  const { outDoc, imageCache } = ctx;
  switch (ann.type) {
    case 'text': {
      const font = await getFontFor(ctx, ann);
      const box = storageRectToPdfLib({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, pageHeight);
      // Editing existing PDF text works by covering the original run (its
      // real glyphs still live in the content stream - there's no portable
      // way to rewrite that in place) with the sampled background color,
      // then drawing the edited text on top in the same spot.
      if (ann.coverRect) {
        const coverBox = storageRectToPdfLib(ann.coverRect, pageHeight);
        page.drawRectangle({ x: coverBox.x, y: coverBox.y, width: coverBox.w, height: coverBox.h, color: hexToRgb(ann.coverColor || '#ffffff') });
      }
      const size = ann.fontSize || 14;
      const lineHeight = size * 1.25;
      const lines = wrapText(font, ann.text || '', size, box.w);
      let cursorY = box.y + box.h - size;
      for (const line of lines) {
        if (cursorY < box.y - lineHeight) break;
        const lineWidth = font.widthOfTextAtSize(line, size);
        let x = box.x;
        if (ann.align === 'center') x = box.x + (box.w - lineWidth) / 2;
        else if (ann.align === 'right') x = box.x + box.w - lineWidth;
        page.drawText(line, { x, y: cursorY, size, font, color: hexToRgb(ann.color) });
        cursorY -= lineHeight;
      }
      break;
    }
    case 'image':
    case 'signature': {
      const embedded = await embedImageForDataUrl(outDoc, imageCache, ann.src);
      const box = storageRectToPdfLib({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, pageHeight);
      page.drawImage(embedded, { x: box.x, y: box.y, width: box.w, height: box.h });
      break;
    }
    case 'rect': {
      const box = storageRectToPdfLib({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, pageHeight);
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        borderColor: hexToRgb(ann.strokeColor),
        borderWidth: ann.strokeWidth || 2,
        color: ann.fillColor ? hexToRgb(ann.fillColor) : undefined,
        opacity: ann.fillColor ? (ann.fillOpacity ?? 1) : 0,
        borderOpacity: 1
      });
      break;
    }
    case 'highlight': {
      const box = storageRectToPdfLib({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, pageHeight);
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        color: hexToRgb(ann.color || '#ffff00'),
        opacity: ann.opacity ?? 0.4
      });
      break;
    }
    case 'line':
    case 'arrow': {
      const p1 = { x: ann.x1, y: pageHeight - ann.y1 };
      const p2 = { x: ann.x2, y: pageHeight - ann.y2 };
      const color = hexToRgb(ann.strokeColor);
      const thickness = ann.strokeWidth || 2;
      page.drawLine({ start: p1, end: p2, thickness, color });
      if (ann.type === 'arrow') {
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headLen = Math.max(10, thickness * 4);
        const spread = Math.PI / 7;
        for (const sign of [1, -1]) {
          const hx = p2.x - headLen * Math.cos(angle - sign * spread);
          const hy = p2.y - headLen * Math.sin(angle - sign * spread);
          page.drawLine({ start: p2, end: { x: hx, y: hy }, thickness, color });
        }
      }
      break;
    }
    case 'pen': {
      const color = hexToRgb(ann.strokeColor);
      const thickness = ann.strokeWidth || 2;
      const pts = ann.points.map((p) => ({ x: p.x, y: pageHeight - p.y }));
      for (let i = 1; i < pts.length; i++) {
        page.drawLine({ start: pts[i - 1], end: pts[i], thickness, color });
      }
      break;
    }
    default:
      break;
  }
}

/** Rasterize a page to a PNG data URL at high resolution, with solid black
 * boxes burned in over each redaction rect. This guarantees the underlying
 * vector text/graphics are gone from the saved file (see bakeDocument). */
async function rasterizePageWithRedactions(pdfjsDoc, sourceIndex, redactRects, storageW, storageH) {
  const page = await pdfjsDoc.getPage(sourceIndex + 1);
  const scale = 3;
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx2d = canvas.getContext('2d');
  await page.render({ canvasContext: ctx2d, viewport }).promise;

  ctx2d.fillStyle = '#000000';
  const sx = canvas.width / storageW;
  const sy = canvas.height / storageH;
  for (const r of redactRects) {
    ctx2d.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
  }
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Save / bake
// ---------------------------------------------------------------------------

function isPristineStructure(pages, originalPageCount) {
  if (pages.length !== originalPageCount) return false;
  return pages.every((p, i) => p.source === 'self' && p.sourceIndex === i);
}

/**
 * Turn the current editor state (page plan + annotation overlays) into
 * final PDF bytes.
 *
 * Two strategies:
 *  - "in place": when the page order/count/source is untouched, we edit
 *    the ORIGINAL pdf-lib document directly. This preserves bookmarks,
 *    metadata and every other structural detail pdf-lib doesn't expose a
 *    high-level API for.
 *  - "rebuild": when pages were inserted/deleted/reordered/merged, or any
 *    page carries a redaction, we assemble a brand new PDFDocument. For a
 *    redacted page we never copy the original page into the new document
 *    at all - only a flattened raster of it - so the redacted content
 *    never enters the saved file.
 */
export async function bakeDocument({ docState, resources, formValues }) {
  const { originalBytes, pdfjsDoc, externalSources, customFonts } = resources;
  const anyRedaction = docState.pages.some((p) =>
    (docState.annotations[p.key] || []).some((a) => a.type === 'redact')
  );
  const pristine = !anyRedaction && isPristineStructure(docState.pages, pdfjsDoc.numPages);

  const externalDocCache = new Map();
  async function getExternalDoc(sourceKey) {
    if (externalDocCache.has(sourceKey)) return externalDocCache.get(sourceKey);
    const bytes = externalSources.get(sourceKey);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    externalDocCache.set(sourceKey, doc);
    return doc;
  }

  const imageCache = new Map();
  const standardFontCache = new Map();
  const customFontCache = new Map();

  if (pristine) {
    const outDoc = await PDFDocument.load(originalBytes);
    outDoc.registerFontkit(fontkit);
    const ctx = { outDoc, imageCache, standardFontCache, customFonts, customFontCache };
    const pdfPages = outDoc.getPages();
    for (let i = 0; i < docState.pages.length; i++) {
      const entry = docState.pages[i];
      const page = pdfPages[i];
      page.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
      const anns = docState.annotations[entry.key] || [];
      for (const ann of anns) {
        await drawAnnotation(ctx, page, ann, entry.height);
      }
    }
    applyFormValues(outDoc, formValues);
    outDoc.setProducer('PDF Editor');
    outDoc.setModificationDate(new Date());
    return outDoc.save();
  }

  // Rebuild path
  const outDoc = await PDFDocument.create();
  outDoc.registerFontkit(fontkit);
  const ctx = { outDoc, imageCache, standardFontCache, customFonts, customFontCache };
  const selfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });

  for (const entry of docState.pages) {
    const anns = docState.annotations[entry.key] || [];
    const redactRects = anns.filter((a) => a.type === 'redact');
    let page;

    if (redactRects.length > 0) {
      const dataUrl = await rasterizePageWithRedactions(
        pdfjsDoc,
        entry.sourceIndex,
        redactRects,
        entry.width,
        entry.height
      );
      page = outDoc.addPage([entry.width, entry.height]);
      const embedded = await embedImageForDataUrl(outDoc, imageCache, dataUrl);
      page.drawImage(embedded, { x: 0, y: 0, width: entry.width, height: entry.height });
    } else if (entry.source === 'blank') {
      page = outDoc.addPage([entry.width, entry.height]);
    } else {
      const srcDoc = entry.source === 'self' ? selfDoc : await getExternalDoc(entry.source);
      const [copied] = await outDoc.copyPages(srcDoc, [entry.sourceIndex]);
      page = outDoc.addPage(copied);
    }

    page.setRotation(degrees(((entry.rotation % 360) + 360) % 360));

    for (const ann of anns) {
      if (ann.type === 'redact') continue;
      await drawAnnotation(ctx, page, ann, entry.height);
    }
  }

  applyFormValues(outDoc, formValues);
  outDoc.setProducer('PDF Editor');
  outDoc.setModificationDate(new Date());
  return outDoc.save();
}

// ---------------------------------------------------------------------------
// Merge / split / export
// ---------------------------------------------------------------------------

export async function mergePdfs(files) {
  const outDoc = await PDFDocument.create();
  for (const file of files) {
    const src = await PDFDocument.load(file.data, { ignoreEncryption: true });
    const pages = await outDoc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => outDoc.addPage(p));
  }
  outDoc.setProducer('PDF Editor');
  return outDoc.save();
}

/** ranges: array of { from, to } 1-based inclusive page numbers. */
export async function splitPdf(bytes, ranges) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const results = [];
  for (const range of ranges) {
    const outDoc = await PDFDocument.create();
    const indices = [];
    for (let i = range.from; i <= range.to; i++) indices.push(i - 1);
    const pages = await outDoc.copyPages(src, indices);
    pages.forEach((p) => outDoc.addPage(p));
    outDoc.setProducer('PDF Editor');
    const data = await outDoc.save();
    results.push({ name: `pages_${range.from}-${range.to}.pdf`, data });
  }
  return results;
}

export async function exportPagesAsImages(pdfjsDoc, pageNumbers, format, scale) {
  const results = [];
  for (const pageNum of pageNumbers) {
    const page = await pdfjsDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale || 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx2d = canvas.getContext('2d');
    if (format === 'jpg') {
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: ctx2d, viewport }).promise;
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, 0.92);
    const base64 = dataUrl.split(',')[1];
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    results.push({ name: `page_${String(pageNum).padStart(3, '0')}.${format}`, data });
  }
  return results;
}

export { StandardFonts, rgb };
