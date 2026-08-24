/**
 * Non-serializable, per-document runtime resources that don't belong in the
 * Zustand store (pdf.js document proxies, raw file bytes, cached custom
 * font bytes). Keyed by document id, kept in a plain module-level Map so
 * large binary buffers never get deep-cloned into undo/redo snapshots.
 */
const resources = new Map();

export function setResource(docId, patch) {
  const existing = resources.get(docId) || {};
  resources.set(docId, { ...existing, ...patch });
}

export function getResource(docId) {
  return resources.get(docId);
}

export function deleteResource(docId) {
  const r = resources.get(docId);
  if (r && r.pdfjsDoc) {
    r.pdfjsDoc.destroy();
  }
  if (r && r.externalPdfjsDocs) {
    for (const d of r.externalPdfjsDocs.values()) d.destroy();
  }
  resources.delete(docId);
}

/** externalSources: Map<sourceKey, Uint8Array> - bytes for pages copied in from other PDFs. */
export function addExternalSource(docId, sourceKey, bytes) {
  const r = resources.get(docId) || {};
  const externalSources = r.externalSources || new Map();
  externalSources.set(sourceKey, bytes);
  setResource(docId, { externalSources });
}

/** externalPdfjsDocs: Map<sourceKey, pdfjsDoc> - so inserted pages can be rendered/edited too. */
export function addExternalPdfjsDoc(docId, sourceKey, pdfjsDoc) {
  const r = resources.get(docId) || {};
  const externalPdfjsDocs = r.externalPdfjsDocs || new Map();
  externalPdfjsDocs.set(sourceKey, pdfjsDoc);
  setResource(docId, { externalPdfjsDocs });
}

/** customFonts: Map<fontId, {bytes, name}> for user-loaded .ttf/.otf files. */
export function addCustomFont(docId, fontId, bytes, name) {
  const r = resources.get(docId) || {};
  const customFonts = r.customFonts || new Map();
  customFonts.set(fontId, { bytes, name });
  setResource(docId, { customFonts });
}

/** googleFontCache: Map<"family:bold:italic", fontId> - avoids re-fetching
 * the same Google Font repeatedly while editing multiple runs in one doc. */
export function getCachedGoogleFontId(docId, cacheKey) {
  return resources.get(docId)?.googleFontCache?.get(cacheKey);
}
export function cacheGoogleFontId(docId, cacheKey, fontId) {
  const r = resources.get(docId) || {};
  const googleFontCache = r.googleFontCache || new Map();
  googleFontCache.set(cacheKey, fontId);
  setResource(docId, { googleFontCache });
}
