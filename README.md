# PDF Editor

A lightweight, fully offline desktop PDF editor for Windows - view, edit,
annotate, sign, and save PDFs, packaged as a single installable `.exe`
(and a portable `.exe`). Built with Electron + React, [pdf.js](https://mozilla.github.io/pdf.js/)
for rendering and [pdf-lib](https://pdf-lib.js.org/) for editing. No
telemetry, no network access - everything runs on your machine.

## Features

- **Viewing** - open one or many PDFs (tabs), drag & drop, continuous or
  single-page scrolling, zoom / fit-width / fit-page, page-number jump,
  thumbnail sidebar with drag-to-reorder, clickable outline/bookmarks,
  full-text search with highlighting and next/previous navigation.
- **Editing** - click directly on existing PDF text to edit it in place
  (the original run is covered with its sampled background color and the
  edit drawn on top - PDF has no portable way to rewrite a content stream
  in place, so this is the same approach every lightweight editor uses),
  plus new text boxes (font family/size/color/bold/italic/alignment,
  standard fonts, any font installed on your PC via the Local Font Access
  picker, or a loaded `.ttf`/`.otf`), images, rectangles, lines, arrows,
  freehand pen, highlights, and a redaction tool that rasterizes the
  affected page so the underlying content is genuinely removed, not just
  covered. A Layers panel shows every object on the page top-to-bottom
  (paint order) with drag-to-reorder and front/forward/backward/back
  controls. Insert/delete/duplicate/rotate/reorder pages, insert pages
  from another PDF. Undo/redo and standard shortcuts (Ctrl+Z/Y, Ctrl+S,
  Ctrl+O, Ctrl+F, Delete, ...).
- **Forms** - detects existing AcroForm fields (text, checkbox, radio,
  dropdown) and fills them from a side panel.
- **Signing** - visual signatures (draw / type / upload an image, then
  place & resize on any page) and real cryptographic digital signatures
  from a `.pfx`/`.p12` certificate, with a signature-status check shown
  when a signed PDF is opened.
- **Saving** - Save / Save As, merge multiple PDFs, split by page range,
  export pages as PNG/JPG, and set/remove a PDF's open password with
  permission flags (print/edit/copy/annotate).
- **UI** - toolbar grouped by function, sidebar (thumbnails/outline/
  search/forms), properties panel for the selected object, light/dark
  theme, lazy page rendering so large (100+ page) documents stay
  responsive, and clear error/password prompts instead of silent
  failures on corrupt or encrypted files.

## Tech stack

| Concern | Library |
|---|---|
| Shell | Electron |
| UI | React 18 + Vite |
| State | Zustand |
| Rendering | pdf.js (`pdfjs-dist`) |
| Editing / saving | pdf-lib + `@pdf-lib/fontkit` (custom font embedding) |
| Move/resize overlay objects | `react-rnd` |
| Digital signatures | `@signpdf/*` + `node-forge` (PKCS#7 signing/verification) |
| Password protection | Hand-rolled PDF Standard Security Handler (RC4-128), see below |
| Packaging | `electron-builder` (NSIS installer + portable exe) |

## Folder structure

```
pdf-editor/
├─ src/
│  ├─ main/              Electron main process
│  │  ├─ main.js         App lifecycle, window, all ipcMain handlers (file I/O, dialogs)
│  │  ├─ menu.js          Application menu -> forwards actions to the renderer
│  │  └─ signing.js        Digital signature creation + verification (node-forge, @signpdf)
│  ├─ preload/
│  │  └─ preload.js       contextBridge API exposed to the renderer as `window.pdfEditor`
│  └─ renderer/           React app (loaded via Vite)
│     ├─ App.jsx           Top-level shell: tabs, menu-action wiring, drag & drop, save flow
│     ├─ components/       Toolbar, Sidebar, Viewer, AnnotationLayer, PropertiesPanel, Dialogs, StatusBar
│     ├─ state/
│     │  ├─ store.js       Zustand store: documents, tools, history (undo/redo), UI state
│     │  └─ docResources.js  Non-serializable per-doc resources (pdf.js docs, raw bytes, fonts)
│     └─ pdf/
│        ├─ documentIO.js  Open/bake/merge/split/export - the pdf-lib <-> app-state bridge
│        ├─ security.js    RC4-128 Standard Security Handler (encrypt/decrypt)
│        ├─ coords.js      Screen <-> stored-annotation coordinate conversion (rotation/zoom-safe)
│        ├─ viewportMath.js  pdf.js-compatible viewport math for pages with no pdf.js proxy (blank pages)
│        ├─ fonts.js       Standard font table + custom font helpers
│        └─ textSearch.js  Full-text search over a pdf.js document
├─ scripts/
│  ├─ verify-encryption.mjs  Standalone round-trip test for security.js (see Testing)
│  ├─ smoke-test.mjs         Headless Electron smoke test via Playwright
│  └─ make-icons.mjs         Regenerates build/icon.png + build/icon.ico from scripts/icon.svg
├─ build/                 electron-builder resources (icon.ico / icon.png)
├─ vite.config.js
└─ package.json           Scripts + electron-builder config (the "build" field)
```

## Setup

Requires Node.js 18+.

```bash
npm install
```

## Run in development

```bash
npm run dev
```

This starts the Vite dev server and Electron together (with hot reload for
the renderer). DevTools open automatically.

## Build a Windows .exe

```bash
npm run dist            # both installer and portable exe
npm run dist:installer  # NSIS installer only
npm run dist:portable   # portable exe only
```

Output goes to `release/`:

- `PDF Editor Setup <version>.exe` - NSIS installer (user chooses install
  directory, creates Start Menu/Desktop shortcuts).
- `PDF-Editor-Portable-<version>.exe` - single-file portable exe, no
  installation required.

Building for Windows works from Windows directly. **Building the Windows
target from Linux/macOS** requires [Wine](https://www.winehq.org/) (used by
electron-builder to embed the icon/version info into the `.exe`) - e.g. on
Ubuntu: `sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install wine32:i386 wine64 wine`.

To regenerate the app icon from `scripts/icon.svg`, run `node scripts/make-icons.mjs`
(requires Playwright's Chromium, only needed if you change the icon design).

## Testing

There's no full test suite (out of scope for this build), but two scripts
validate the highest-risk, hand-rolled pieces:

- `node scripts/verify-encryption.mjs` - encrypts a PDF with `security.js`,
  then confirms an independent implementation (pdf.js) can decrypt it with
  the user *and* owner password, rejects wrong passwords, and that
  `removePasswordProtection` correctly strips protection.
- `node scripts/smoke-test.mjs` - launches the real packaged app under
  Playwright/Xvfb, opens a generated PDF, and exercises the toolbar/canvas
  to catch boot-time or render-time crashes.

## Known limitations

- **Editing existing text** covers the original run (background-color
  sampled from the rendered page) and draws the edit on top, rather than
  rewriting the PDF's content stream - there's no portable, general way to
  do the latter. It's click-target granularity is per text run as pdf.js
  reports them, which is usually a word or short phrase rather than an
  entire sentence.
- **System font access** (the "System Fonts..." picker) needs Chromium's
  Local Font Access API, which requires the user to grant permission the
  first time it's used; if it's unavailable or denied, "Load .ttf/.otf..."
  still works as a direct fallback. Fetching fonts from Google Fonts was
  intentionally not implemented, since it would require network access
  this app otherwise never makes.
- **Password protection** implements the classic PDF **RC4 128-bit**
  Standard Security Handler (opens in every mainstream reader). Removing/
  editing a password-protected PDF that uses **AES** encryption (common
  from recent Acrobat versions) isn't supported for *editing* - such files
  can still be **viewed** (pdf.js decrypts AES natively) with a clear
  "view only" notice.
- **Bookmarks/outline** are preserved on save as long as no pages were
  inserted/deleted/reordered/merged (the common "just add some text/
  annotations" case edits the original PDF in place). Structural page
  edits rebuild the PDF from scratch, which currently does not carry the
  original outline into the new file.
- **Digital signature verification** checks that the signed byte range's
  hash matches the signature and reports the signing certificate's own
  claims (issuer, validity dates); it does not walk the certificate chain
  against your OS's trusted root store.
- Very large documents (500+ pages) render lazily but aren't fully
  virtualized (rendered pages stay in the DOM once shown), so extremely
  long documents may use more memory than a dedicated virtualized viewer.

## Offline / privacy

The app makes no network requests: `connect-src 'none'` is set in the
renderer's CSP, pdf.js's font/CMap fetching and evaluation are disabled,
and Electron's auto-updater is not wired up. Everything - rendering,
editing, signing, encryption - happens locally.
