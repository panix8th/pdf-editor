# Paperlight

A lightweight, offline-by-default desktop PDF editor for Windows - view,
edit, annotate, sign, and save PDFs, packaged as a single installable
`.exe` (and a portable `.exe`). Built with Electron + React, [pdf.js](https://mozilla.github.io/pdf.js/)
for rendering and [pdf-lib](https://pdf-lib.js.org/) for editing. No
telemetry, ever. The one deliberate exception to "no network access" is
described in [Offline / privacy](#offline--privacy) below: matching the
original font when editing existing text can fetch that font from Google
Fonts.

## Features

- **Viewing** - open one or many PDFs (tabs), drag & drop, continuous or
  single-page scrolling, zoom / fit-width / fit-page, page-number jump,
  thumbnail sidebar with drag-to-reorder, clickable outline/bookmarks,
  full-text search with highlighting and next/previous navigation.
- **Text selection & editing** - drag across the page with the Select
  tool to select text exactly like any PDF viewer (double-click for a
  word, triple-click for a line), then either **Copy** it (Ctrl+C) or
  **Edit text** (Enter) to replace it. Selecting across several runs -
  an address block where every line is its own run, say - merges them
  into one editable box rather than making you edit line by line.
  Font, size, color and bold/italic are auto-detected from the PDF, and
  the app tries to match the *original font* (fetching it from Google
  Fonts if needed - see [Offline / privacy](#offline--privacy)) rather
  than falling back to a generic substitute.

  The replacement is **not** pasted over a white box. The original glyphs
  are switched to PDF text rendering mode 3 (invisible) directly in the
  page's content stream, so the edit lands on genuinely empty page - it
  looks right over an image, a gradient or a table rule, where a cover
  rectangle in a guessed background color always gave the game away. The
  string itself is left untouched, so every advance and kern after it
  stays bit-identical and nothing shifts. Where that mapping can't be
  trusted (text drawn from inside a Form XObject, a clipping text mode),
  the app detects it and falls back to the old cover-rectangle approach
  rather than risking the wrong glyphs. Note this is not redaction: the
  original characters stay in the text layer, invisible but still
  findable - the Redact tool is what actually destroys content.
- **Annotating** - new text boxes (font family/size/color/bold/italic/
  alignment, standard fonts, any font installed on your PC via the Local
  Font Access picker, any font by name from Google Fonts, or a loaded
  `.ttf`/`.otf`), images (one click inserts a PNG/JPG on the current page,
  ready to drag/resize), rectangles, ellipses, lines, arrows, freehand
  pen, highlights, and a redaction tool that rasterizes the affected page
  so the underlying content is genuinely removed, not just covered. A
  Layers panel shows every object on the page top-to-bottom (paint order)
  with drag-to-reorder and front/forward/backward/back controls.
- **Pages & history** - insert/delete/duplicate/rotate/reorder pages,
  insert pages from another PDF, undo/redo, and the standard shortcuts
  (Ctrl+Z/Y, Ctrl+S, Ctrl+O, Ctrl+F, Delete, ...). Undo steps follow
  whole actions, not keystrokes: typing a word or dragging a slider is one
  step, not thirty.
- **Forms** - detects existing AcroForm fields (text, checkbox, radio,
  dropdown) and fills them from a side panel. The Field tool also adds new
  fillable fields to a PDF that doesn't have them: draw a box, pick a type
  (text/checkbox/dropdown) and a name in the properties panel, and it's
  baked in as a real AcroForm field on save - test-fillable immediately in
  the Forms panel in the same session, before you've even saved.
- **Signing** - visual signatures (draw / type / upload an image, then
  place & resize on any page) and real cryptographic digital signatures
  from a `.pfx`/`.p12` certificate, with a signature-status check shown
  when a signed PDF is opened.
- **Saving** - Save / Save As, merge multiple PDFs, split by page range,
  export pages as PNG/JPG, and set/remove a PDF's open password with
  permission flags (print/edit/copy/annotate).
- **UI** - custom frameless title bar (app mark, document tabs, window
  controls) with a themed menu bar and grouped icon toolbar underneath;
  an icon rail + collapsible, drag-resizable side panel (thumbnails/
  outline/search/forms/layers); a floating view dock over the canvas
  (current tool, single-page/continuous, rotate); a properties panel
  that's contextual to the active tool even with nothing selected yet;
  light/dark theme with three accent colors (lilac/orchid/periwinkle),
  persisted across restarts; an empty-state drop zone with a real
  Recent-files list; lazy page rendering so large (100+ page) documents
  stay responsive; pages and thumbnails rendered at the display's real
  pixel density so text stays sharp on HiDPI/scaled displays; and clear
  error/password prompts instead of silent failures on corrupt or
  encrypted files. Closing a tab or the window with unsaved edits always
  prompts (Save / Discard / Cancel) - nothing is thrown away silently.

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
│  │  ├─ main.js         App lifecycle, frameless window, all ipcMain handlers (file I/O, dialogs, window controls)
│  │  └─ signing.js        Digital signature creation + verification (node-forge, @signpdf)
│  ├─ preload/
│  │  └─ preload.js       contextBridge API exposed to the renderer as `window.pdfEditor`
│  └─ renderer/           React app (loaded via Vite)
│     ├─ App.jsx           Top-level shell: menu-action dispatch + keyboard accelerators, drag & drop, save flow
│     ├─ components/
│     │  ├─ TitleBar.jsx     Frameless custom chrome: mark, doc tabs, minimize/maximize/close
│     │  ├─ MenuBar.jsx      Themed File/Edit/Annotate/Sign/Page/View/Help dropdowns + theme/accent
│     │  ├─ Toolbar.jsx      Grouped icon toolbar (file, history, tools, signing, zoom/page)
│     │  ├─ Sidebar.jsx      Icon rail + resizable side panel (thumbnails/outline/search/forms/layers)
│     │  ├─ Viewer.jsx       Page rendering + the floating view dock
│     │  ├─ AnnotationLayer.jsx  Interactive overlay: text selection, edit-in-place, shapes
│     │  ├─ PropertiesPanel.jsx  Contextual to the active tool/selection
│     │  ├─ Icons.jsx        Shared 20x20-grid stroke icon set
│     │  ├─ PaperlightMark.jsx  The brand mark (see assets/brand/)
│     │  ├─ Dialogs.jsx, StatusBar.jsx
│     ├─ state/
│     │  ├─ store.js       Zustand store: documents, tools, history (undo/redo), UI state, theme/accent
│     │  ├─ docResources.js  Non-serializable per-doc resources (pdf.js docs, raw bytes, fonts)
│     │  └─ recentFiles.js   localStorage-backed "Recent" list for the empty state
│     └─ pdf/
│        ├─ documentIO.js  Open/bake/merge/split/export - the pdf-lib <-> app-state bridge
│        ├─ security.js    RC4-128 Standard Security Handler (encrypt/decrypt)
│        ├─ coords.js      Screen <-> stored-annotation coordinate conversion (rotation/zoom-safe)
│        ├─ viewportMath.js  pdf.js-compatible viewport math for pages with no pdf.js proxy (blank pages)
│        ├─ fonts.js       Standard font table + custom font helpers
│        ├─ shapeGeometry.js  Shape math shared by the live preview and the saved output
│        ├─ placeImage.js  Native "insert an image" picker + placement (content-sniffed, not by extension)
│        ├─ formFields.js  Field-name uniqueness helpers for the Field tool
│        ├─ textRuns.js    Text runs on a page (geometry, font, color) + their content-stream operator index
│        ├─ textSelection.js  Character-level selection geometry over those runs
│        ├─ contentStreamText.js  Content-stream surgery: makes edited glyphs invisible in place
│        └─ textSearch.js  Full-text search over a pdf.js document
├─ scripts/
│  ├─ verify-encryption.mjs  Standalone round-trip test for security.js (see Testing)
│  ├─ text-surgery-test.mjs  Tokenizer + visual proof that hiding a text run works (see Testing)
│  ├─ text-search-test.mjs   Search over real pdf.js output, incl. phrases split across items
│  ├─ smoke-test.mjs         Headless Electron smoke test via Playwright
│  └─ make-icons.mjs         Regenerates build/icon.png + build/icon.ico from scripts/icon.svg
├─ assets/brand/          Paperlight brand assets (mark, wordmark, icon source) + their own README
├─ build/                 electron-builder resources (icon.ico / icon.png)
├─ vite.config.js
└─ package.json           Scripts + electron-builder config (the "build" field)
```

### Window chrome

The window is frameless (`frame: false` in `main.js`) - `TitleBar.jsx` draws
the icon/name, document tabs, and minimize/maximize/close entirely in the
renderer, using `-webkit-app-region: drag`/`no-drag` for window dragging and
an IPC round trip (`window:minimize` / `window:maximizeToggle` / `window:close`
/ `window:isMaximized`, plus a `window:maximizedChange` push event) for the
window-management calls a native frame would otherwise provide. There is no
native application menu (`Menu.setApplicationMenu(null)`) - `MenuBar.jsx` is
the only menu, and **all keyboard accelerators (Ctrl+O, Ctrl+S, ...) are
handled by a renderer-side keydown listener in `App.jsx`**, not Electron's
menu accelerator system: with the native menu bar hidden, its accelerators
turned out not to reliably fire (confirmed empirically while building this),
so the renderer owns them outright rather than treating that as a fallback.

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

- `Paperlight Setup <version>.exe` - NSIS installer (user chooses install
  directory, creates Start Menu/Desktop shortcuts).
- `Paperlight-Portable-<version>.exe` - single-file portable exe, no
  installation required.

Building for Windows works from Windows directly. **Building the Windows
target from Linux/macOS** requires [Wine](https://www.winehq.org/) (used by
electron-builder to embed the icon/version info into the `.exe`) - e.g. on
Ubuntu: `sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install wine32:i386 wine64 wine`.

`build/icon.ico` / `build/icon.png` are the production Paperlight app icon,
straight from `assets/brand/` (see that folder's own README for the full
brand kit - mark geometry, colors, wordmark, other sizes/variants). If you
ever need to regenerate them from `scripts/icon.svg` instead (e.g. while
iterating on the icon design before finalizing a brand asset drop), run
`node scripts/make-icons.mjs` (requires Playwright's Chromium).

## Testing

`npm test` runs all three suites. They cover the highest-risk,
hand-rolled pieces rather than aiming for blanket coverage:

- `npm run test:encryption` - encrypts a PDF with `security.js`, then
  confirms an independent implementation (pdf.js) can decrypt it with the
  user *and* owner password, rejects wrong passwords, and that
  `removePasswordProtection` correctly strips protection.
- `npm run test:surgery` - checks `contentStreamText.js`: that the
  tokenizer never mistakes string, hex-string, comment or inline-image
  payload for an operator (hiding the wrong one would corrupt the page),
  and then *renders* a page before and after an edit with real pdf.js,
  counting dark pixels per line. That last part is the only check that
  actually proves the claim: the edited line's glyphs are gone and every
  other line is pixel-identical.
- `npm run test:search` - runs `textSearch.js` against real pdf.js output,
  including the case that actually breaks naive implementations: pdf.js
  splits a line into several "items", so a multi-word query usually
  straddles a boundary and searching item-by-item finds nothing.
- `npm run test:smoke` - launches the real packaged app under
  Playwright/Xvfb and drives it end to end: drag-select text on the page,
  Ctrl+C, "Edit text", draw every shape, insert images (including a JPEG
  mislabeled `.png`), add a form field, then Save As and inspect the
  saved file - the edited run is invisible in the content stream, a real
  PDF reader sees the replacement text, and **no white cover rectangle was
  painted**. It also covers text the built-in fonts can't encode and the
  unsaved-changes prompt on both tab close and window close. Xvfb in this
  sandbox runs with no window manager at all, so minimize/maximize can't
  be verified for a real state change the way it can on an actual Windows
  desktop - the smoke test only checks that those IPC calls complete
  without throwing.

## Known limitations

- **Adding new form fields** (the Field tool) supports text fields,
  checkboxes, and dropdowns - not radio groups, which need multiple
  on-page widgets (one per option) rather than the single box every other
  field type here draws with. Field names must be unique in the document;
  the properties panel checks this as you rename one, and the save path
  also resolves any leftover collision (e.g. against a field already in
  the original PDF) by appending a number rather than failing the save.
- **Editing existing text** replaces whole text runs, not arbitrary
  character ranges: a selection covering half a run still replaces that
  entire run, because the save path hides whole content-stream operators.
  Runs are as pdf.js reports them, usually a word or short phrase. The
  original glyphs are made invisible rather than deleted, so they remain
  in the text layer and are still found by a search or copy - use Redact
  when content genuinely has to be destroyed. Font/color detection (and
  the run-to-operator mapping the in-place edit depends on) correlates
  pdf.js's text-content items with its low-level drawing operators by
  sequence order; the app verifies the two counts agree before touching
  anything and falls back to a cover rectangle when they don't, so a
  mismatch degrades rather than corrupts.
- **Automatic font matching for click-to-edit-text** tries, in order: (1)
  the exact original font if it's already installed on this PC (via
  Chromium's Local Font Access API - no network, no substitute, the real
  glyphs; this is why editing a Word-exported PDF on Windows usually
  matches Calibri/Cambria/Segoe UI/Arial/Times New Roman/Courier New
  perfectly, since those ship with Windows), (2) that same name against
  the live Google Fonts catalog, (3) a metric-compatible substitute for
  common proprietary fonts Google Fonts doesn't have at all. None of this
  is a fixed lookup list for step 1/2 - any installed or Google-hosted
  font resolves correctly on its own. Only a font that's in neither place
  falls back to the closest built-in standard font (still editable
  immediately either way - matching happens in the background and never
  blocks the edit). Local Font Access needs the user to grant permission
  the first time it's used; if it's unavailable/denied, "Load .ttf/.otf..."
  and "Google Fonts..." still work as direct fallbacks.
- The "System Fonts..." and "Google Fonts..." pickers are also available
  directly from the toolbar/properties panel to fetch any font by name,
  independent of auto-detection.
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
- **Shapes** (rect/ellipse/line/arrow) derive their geometry from one
  shared module (`src/renderer/pdf/shapeGeometry.js`) that both the live
  preview and the save path call, so what you draw is what gets written.
  Strokes are stored in PDF points and inset by half the stroke width when
  baked, because PDF strokes straddle their path while the preview's CSS
  border sits inside the box.
- Very large documents (500+ pages) render lazily but aren't fully
  virtualized (rendered pages stay in the DOM once shown), so extremely
  long documents may use more memory than a dedicated virtualized viewer.
- **The built-in fonts (Helvetica/Times/Courier) are limited to WinAnsi**,
  which is a PDF-format limitation, not an app one - they have no glyphs
  for arrows, box-drawing characters, Cyrillic, CJK or emoji. Rather than
  failing the save (which is what pdf-lib does on its own), such
  characters are substituted with the closest available equivalent and
  you're told which ones changed. Pick a system or Google font for that
  text and it's embedded as a full Unicode subset with no substitution at
  all.

## Offline / privacy

`connect-src 'none'` is set in the renderer's CSP - the UI itself can
never make a network request, full stop. pdf.js's font/CMap fetching and
evaluation are disabled, and Electron's auto-updater is not wired up.
Everything - rendering, editing, signing, encryption - happens locally.

**One deliberate exception**: when you click existing PDF text to edit it,
the app tries to match the original font so the edit doesn't fall back to
generic Helvetica/Times/Courier. It does this by resolving the PDF's real
font name (Arial, Calibri, Roboto, ...) to a Google Fonts family - either
directly, or via a metric-compatible substitute for common proprietary
fonts (Arial→Arimo, Times New Roman→Tinos, Calibri→Carlito, etc.) - and
fetching that one font file. This request is made by the **main process
only** (`src/main/googleFonts.js`), never by the renderer's own network
stack, and only fires on that explicit user action - never automatically
on open or in the background. If it's offline or the font isn't found, it
silently falls back to the closest built-in standard font and the edit
still works immediately (the text box is usable right away; the font
upgrades in place if/when the fetch succeeds). Font size and text color
for edited runs are detected directly from the PDF's own geometry and
fill-color operators - no network involved for either.
