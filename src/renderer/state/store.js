import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  openWithPdfJs,
  buildPageMeta,
  buildOutline,
  detectFormFields,
  PASSWORD_REQUIRED
} from '../pdf/documentIO';
import { setResource, getResource, deleteResource, addExternalSource, addExternalPdfjsDoc, addCustomFont } from './docResources';
import { removePasswordProtection, UnsupportedEncryptionError, isStructurallyEncrypted } from '../pdf/security';
import { placeImageFromDialog } from '../pdf/placeImage';
import { addRecentFile } from './recentFiles';

const MAX_HISTORY = 60;

function snapshot(doc) {
  return {
    pages: doc.pages.map((p) => ({ ...p })),
    annotations: JSON.parse(JSON.stringify(doc.annotations))
  };
}

/** Makes a custom font's exact glyphs available to CSS `font-family` in
 * this window - otherwise setting `fontFamily: 'Bebas Neue'` on an
 * annotation's live-preview element does nothing useful, because the
 * browser has no idea what "Bebas Neue" actually looks like (this is
 * separate from embedding the font into the saved PDF via fontkit, which
 * bakeDocument already does independently from the font bytes cached in
 * docResources). Never throws - a failure here just means the live
 * preview falls back to a generic font; the saved file is unaffected. */
async function registerLiveFontFace(name, bytes) {
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const fontFace = new FontFace(name, buffer);
    await fontFace.load();
    document.fonts.add(fontFace);
  } catch {
    /* live preview only - saved output still embeds the real font bytes */
  }
}

const defaultToolOptions = {
  fontFamily: 'Helvetica',
  fontId: null,
  fontSize: 16,
  color: '#111111',
  bold: false,
  italic: false,
  align: 'left',
  strokeColor: '#e11d48',
  strokeWidth: 3,
  fillColor: '',
  fillOpacity: 0.3,
  highlightColor: '#ffe066'
};

function readPersisted(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writePersisted(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* persistence is best-effort - theme/accent still work for this session */
  }
}

export const useStore = create((set, get) => ({
  theme: readPersisted('paperlight:theme', 'dark'),
  accent: readPersisted('paperlight:accent', 'lilac'),
  sidebarOpen: true,
  sidebarTab: 'thumbnails',
  documents: {},
  order: [],
  activeId: null,
  dialog: null,
  toast: null,

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === 'dark' ? 'light' : 'dark';
      writePersisted('paperlight:theme', theme);
      return { theme };
    }),
  setAccent: (accent) => {
    writePersisted('paperlight:accent', accent);
    set({ accent });
  },
  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openDialog: (type, props) => set({ dialog: { type, props: props || {} } }),
  openFontPicker: (docId, onPick) => set({ dialog: { type: 'fontPicker', props: { docId, onPick } } }),
  openGoogleFontPicker: (docId, onPick) => set({ dialog: { type: 'googleFontPicker', props: { docId, onPick } } }),
  closeDialog: () => set({ dialog: null }),
  showToast: (type, message) => set({ toast: { id: uuid(), type, message } }),
  clearToast: () => set({ toast: null }),

  // ------------------------------------------------------------------
  // Document lifecycle
  // ------------------------------------------------------------------
  async openFile(fileMeta, password) {
    const { showToast } = get();
    let pdfjsDoc;
    try {
      pdfjsDoc = await openWithPdfJs(fileMeta.data, password);
    } catch (err) {
      if (err.code === PASSWORD_REQUIRED) {
        get().openDialog('password', { fileMeta, retry: !!password });
        return null;
      }
      showToast('error', `Could not open "${fileMeta.name}": ${err.message}`);
      return null;
    }

    const id = uuid();
    const pages = await buildPageMeta(pdfjsDoc);
    const outline = await buildOutline(pdfjsDoc);
    const pdfVersion = await pdfjsDoc
      .getMetadata()
      .then((m) => m.info?.PDFFormatVersion || null)
      .catch(() => null);

    let editableBytes = fileMeta.data;
    let editingUnsupported = false;
    // A PDF can be structurally encrypted (its strings/streams are ciphertext)
    // even with a blank user password, in which case pdf.js never prompted
    // for one above - so check the bytes directly rather than trusting
    // whether a password was supplied.
    const structurallyEncrypted = await isStructurallyEncrypted(fileMeta.data);
    if (structurallyEncrypted) {
      try {
        editableBytes = await removePasswordProtection(fileMeta.data, password || '');
        if (password) {
          showToast(
            'info',
            'Opened a password-protected PDF. Saving will produce an unprotected copy unless you re-apply a password from File > Set/Remove Password.'
          );
        }
      } catch (err) {
        editingUnsupported = true;
        if (!(err instanceof UnsupportedEncryptionError)) {
          showToast('info', 'This PDF uses an encryption type this app can only view, not edit.');
        }
      }
    }
    const formFields = editingUnsupported ? [] : await detectFormFields(editableBytes);

    let signatureStatus = null;
    try {
      const result = await window.pdfEditor.verifySignatures(fileMeta.data);
      if (result.ok && result.signatures.length > 0) signatureStatus = result.signatures;
    } catch {
      // non-fatal - signature status just won't be shown
    }

    setResource(id, {
      pdfjsDoc,
      originalBytes: editableBytes,
      externalSources: new Map(),
      customFonts: new Map()
    });

    const annotations = {};
    pages.forEach((p) => (annotations[p.key] = []));

    const docState = {
      id,
      name: fileMeta.name,
      filePath: fileMeta.path || null,
      pdfVersion,
      fileSize: fileMeta.data.length,
      isEncrypted: structurallyEncrypted,
      password: password || null,
      pageCount: pages.length,
      pages,
      outline,
      formFields,
      formValues: formFields.map((f) => ({ name: f.name, value: f.value })),
      signatureStatus,
      annotations,
      zoom: 1,
      fitMode: 'width',
      viewMode: 'continuous',
      currentPage: 1,
      tool: 'select',
      toolOptions: { ...defaultToolOptions },
      selection: null,
      history: { past: [], future: [] },
      dirty: false,
      search: { query: '', matches: [], activeIndex: -1 },
      scrollTarget: null,
      editingUnsupported,
      customFontsList: []
    };

    set((s) => ({
      documents: { ...s.documents, [id]: docState },
      order: [...s.order, id],
      activeId: id
    }));
    get().closeDialog();
    if (fileMeta.path) addRecentFile({ name: fileMeta.name, path: fileMeta.path, pageCount: pages.length });
    return id;
  },

  closeDocument(id) {
    deleteResource(id);
    set((s) => {
      const documents = { ...s.documents };
      delete documents[id];
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? order[order.length - 1] || null : s.activeId;
      return { documents, order, activeId };
    });
  },

  setActive(id) {
    set({ activeId: id });
  },

  active() {
    const s = get();
    return s.documents[s.activeId] || null;
  },

  updateDoc(id, patch) {
    set((s) => (s.documents[id] ? { documents: { ...s.documents, [id]: { ...s.documents[id], ...patch } } } : s));
  },

  markDirty(id) {
    get().updateDoc(id, { dirty: true });
  },

  // ------------------------------------------------------------------
  // History (undo/redo) - snapshot based, scoped to pages+annotations
  // ------------------------------------------------------------------
  pushHistory(id) {
    const doc = get().documents[id];
    if (!doc) return;
    const past = [...doc.history.past, snapshot(doc)].slice(-MAX_HISTORY);
    get().updateDoc(id, { history: { past, future: [] } });
  },

  /** Everything derived from a restored page list, so undo/redo can't
   * leave the page count or the current page pointing at a document that
   * no longer exists (undoing an insert used to leave the count one too
   * high, and undoing a delete could strand the view past the last page). */
  restoreSnapshot(doc, snap) {
    return {
      ...snap,
      pageCount: snap.pages.length,
      currentPage: Math.min(Math.max(1, doc.currentPage), snap.pages.length)
    };
  },

  undo(id) {
    const doc = get().documents[id];
    if (!doc || doc.history.past.length === 0) return;
    const past = [...doc.history.past];
    const prev = past.pop();
    const future = [snapshot(doc), ...doc.history.future].slice(0, MAX_HISTORY);
    get().updateDoc(id, { ...get().restoreSnapshot(doc, prev), history: { past, future }, dirty: true, selection: null });
  },

  redo(id) {
    const doc = get().documents[id];
    if (!doc || doc.history.future.length === 0) return;
    const future = [...doc.history.future];
    const next = future.shift();
    const past = [...doc.history.past, snapshot(doc)].slice(-MAX_HISTORY);
    get().updateDoc(id, { ...get().restoreSnapshot(doc, next), history: { past, future }, dirty: true, selection: null });
  },

  // ------------------------------------------------------------------
  // View state
  // ------------------------------------------------------------------
  setZoom(id, zoom) {
    get().updateDoc(id, { zoom: Math.max(0.2, Math.min(6, zoom)), fitMode: 'none' });
  },
  setFitMode(id, fitMode) {
    get().updateDoc(id, { fitMode });
  },
  setViewMode(id, viewMode) {
    get().updateDoc(id, { viewMode });
  },
  setCurrentPage(id, currentPage) {
    get().updateDoc(id, { currentPage });
  },
  scrollToPage(id, index) {
    get().updateDoc(id, { scrollTarget: { index, nonce: uuid() } });
  },
  setTool(id, tool) {
    get().updateDoc(id, { tool, selection: null });
  },

  /**
   * Inserts an image on the current page in one step: pick a file, drop it
   * centered on the page, select it. Image is an action rather than a mode
   * because a mode gave no hint that a second click on the page was needed
   * to place anything - so the button looked like it did nothing.
   */
  async insertImage(id) {
    const doc = get().documents[id];
    if (!doc) return;
    const page = doc.pages[doc.currentPage - 1];
    if (!page) return;
    const annId = await placeImageFromDialog(
      id,
      page.key,
      null,
      null,
      get().addAnnotation,
      get().setTool,
      get().showToast,
      { width: page.width, height: page.height }
    );
    if (annId) get().selectObject(id, page.key, annId);
  },
  setToolOptions(id, patch) {
    const doc = get().documents[id];
    if (!doc) return;
    get().updateDoc(id, { toolOptions: { ...doc.toolOptions, ...patch } });
  },
  selectObject(id, pageKey, objectId) {
    get().updateDoc(id, { selection: objectId ? { pageKey, objectId } : null });
  },

  // ------------------------------------------------------------------
  // Annotations
  // ------------------------------------------------------------------
  addAnnotation(id, pageKey, annotation, { record = true } = {}) {
    // Guarded because these can be reached from async work that outlives
    // the document - the background font upgrade after an in-place text
    // edit, for one, which lands well after the user could have closed it.
    const doc = get().documents[id];
    if (!doc) return;
    if (record) get().pushHistory(id);
    const list = [...(doc.annotations[pageKey] || []), annotation];
    get().updateDoc(id, {
      annotations: { ...doc.annotations, [pageKey]: list },
      dirty: true,
      selection: { pageKey, objectId: annotation.id }
    });
  },

  updateAnnotation(id, pageKey, objectId, patch, { record = false } = {}) {
    const doc = get().documents[id];
    if (!doc) return;
    if (record) get().pushHistory(id);
    const list = (doc.annotations[pageKey] || []).map((a) => (a.id === objectId ? { ...a, ...patch } : a));
    get().updateDoc(id, { annotations: { ...doc.annotations, [pageKey]: list }, dirty: true });
  },

  deleteAnnotation(id, pageKey, objectId) {
    const doc = get().documents[id];
    if (!doc) return;
    get().pushHistory(id);
    const list = (doc.annotations[pageKey] || []).filter((a) => a.id !== objectId);
    get().updateDoc(id, {
      annotations: { ...doc.annotations, [pageKey]: list },
      dirty: true,
      selection: null
    });
  },

  deleteSelected(id) {
    const doc = get().documents[id];
    if (!doc || !doc.selection) return;
    get().deleteAnnotation(id, doc.selection.pageKey, doc.selection.objectId);
  },

  /** Paint order == array order (later entries render on top). */
  reorderAnnotations(id, pageKey, newList) {
    const doc = get().documents[id];
    if (!doc) return;
    get().pushHistory(id);
    get().updateDoc(id, { annotations: { ...doc.annotations, [pageKey]: newList }, dirty: true });
  },

  moveAnnotationLayer(id, pageKey, objectId, direction) {
    const doc = get().documents[id];
    if (!doc) return;
    const list = [...(doc.annotations[pageKey] || [])];
    const idx = list.findIndex((a) => a.id === objectId);
    if (idx < 0) return;
    const [item] = list.splice(idx, 1);
    if (direction === 'front') list.push(item);
    else if (direction === 'back') list.unshift(item);
    else if (direction === 'forward') list.splice(Math.min(idx + 1, list.length), 0, item);
    else if (direction === 'backward') list.splice(Math.max(idx - 1, 0), 0, item);
    get().reorderAnnotations(id, pageKey, list);
  },

  // ------------------------------------------------------------------
  // Page operations
  // ------------------------------------------------------------------
  insertBlankPage(id, afterIndex, size) {
    const doc = get().documents[id];
    if (!doc) return;
    get().pushHistory(id);
    const [w, h] = size || [612, 792];
    const key = `blank-${uuid()}`;
    const entry = { key, source: 'blank', sourceIndex: 0, rotation: 0, width: w, height: h };
    const pages = [...doc.pages];
    pages.splice(afterIndex + 1, 0, entry);
    get().updateDoc(id, {
      pages,
      pageCount: pages.length,
      annotations: { ...doc.annotations, [key]: [] },
      dirty: true
    });
  },

  async insertPagesFromFile(id, afterIndex, fileMeta) {
    // The file is loaded before any state changes, so a failure here
    // leaves nothing behind - no stray undo step for an insert that never
    // happened.
    const pdfjsDoc = await openWithPdfJs(fileMeta.data);
    const meta = await buildPageMeta(pdfjsDoc);
    const doc = get().documents[id];
    if (!doc) return;
    get().pushHistory(id);
    const sourceKey = `ext-${uuid()}`;
    addExternalSource(id, sourceKey, fileMeta.data);
    addExternalPdfjsDoc(id, sourceKey, pdfjsDoc);
    const newEntries = meta.map((m) => ({
      key: `ins-${uuid()}`,
      source: sourceKey,
      sourceIndex: m.sourceIndex,
      rotation: m.rotation,
      width: m.width,
      height: m.height
    }));
    const pages = [...doc.pages];
    pages.splice(afterIndex + 1, 0, ...newEntries);
    const annotations = { ...doc.annotations };
    newEntries.forEach((e) => (annotations[e.key] = []));
    get().updateDoc(id, { pages, pageCount: pages.length, annotations, dirty: true });
  },

  deletePage(id, pageKey) {
    const doc = get().documents[id];
    if (!doc) return;
    if (doc.pages.length <= 1) {
      get().showToast('error', 'A document needs at least one page.');
      return;
    }
    get().pushHistory(id);
    const pages = doc.pages.filter((p) => p.key !== pageKey);
    const annotations = { ...doc.annotations };
    delete annotations[pageKey];
    get().updateDoc(id, {
      pages,
      pageCount: pages.length,
      annotations,
      // Deleting the page you were looking at would otherwise leave the
      // view pointing past the end of the document.
      currentPage: Math.min(doc.currentPage, pages.length),
      selection: doc.selection?.pageKey === pageKey ? null : doc.selection,
      dirty: true
    });
  },

  duplicatePage(id, pageKey) {
    const doc = get().documents[id];
    if (!doc) return;
    const idx = doc.pages.findIndex((p) => p.key === pageKey);
    if (idx < 0) return;
    get().pushHistory(id);
    const original = doc.pages[idx];
    const copy = { ...original, key: `dup-${uuid()}` };
    const pages = [...doc.pages];
    pages.splice(idx + 1, 0, copy);
    const annotations = {
      ...doc.annotations,
      [copy.key]: (doc.annotations[pageKey] || []).map((a) => ({ ...a, id: uuid() }))
    };
    get().updateDoc(id, { pages, pageCount: pages.length, annotations, dirty: true });
  },

  rotatePage(id, pageKey, deltaDegrees) {
    const doc = get().documents[id];
    if (!doc) return;
    get().pushHistory(id);
    const pages = doc.pages.map((p) =>
      p.key === pageKey ? { ...p, rotation: (((p.rotation + deltaDegrees) % 360) + 360) % 360 } : p
    );
    get().updateDoc(id, { pages, dirty: true });
  },

  reorderPages(id, newPages) {
    get().pushHistory(id);
    get().updateDoc(id, { pages: newPages, dirty: true });
  },

  // ------------------------------------------------------------------
  // Fonts
  // ------------------------------------------------------------------
  registerCustomFont(id, fontId, bytes, name) {
    const doc = get().documents[id];
    if (!doc) return;
    addCustomFont(id, fontId, bytes, name);
    const customFontsList = [...(doc.customFontsList || []), { id: fontId, name }];
    get().updateDoc(id, { customFontsList });
    registerLiveFontFace(name, bytes);
  },

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  setSearch(id, patch) {
    const doc = get().documents[id];
    if (!doc) return;
    get().updateDoc(id, { search: { ...doc.search, ...patch } });
  }
}));

export { getResource };
