/**
 * Headless smoke test: launches the packaged Electron app under Xvfb via
 * Playwright, opens a generated test PDF (by simulating the "opened
 * externally" IPC path so we don't have to drive a native file dialog),
 * exercises core interactions - including a REAL end-to-end Save (with
 * dialog.showSaveDialog monkey-patched in the main process so no UI is
 * needed) - and saves screenshots for visual inspection.
 *
 * This specifically guards against the "No PDF header found" save bug:
 * pdf.js can transfer/detach the ArrayBuffer it's given to its worker, so
 * a real Electron renderer (with a real Worker) is required to catch it -
 * a plain Node reproduction doesn't exhibit it because Node's pdf.js fake
 * worker has no structured-clone/transfer boundary.
 *
 * Run with: node scripts/smoke-test.mjs
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { _electron: electron } = pw;
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
// The legacy build is CommonJS, so its API hangs off the default export.
import pdfjsModule from 'pdfjs-dist/legacy/build/pdf.js';
const pdfjs = pdfjsModule.default || pdfjsModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function makeTestPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Smoke Test PDF - Hello World', { x: 50, y: 700, size: 24, font });
  doc.setTitle('Smoke Test');
  const outline = doc.addPage([612, 792]);
  outline.drawText('Second page', { x: 50, y: 700, size: 24, font });
  return doc.save();
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

/** A page's /Contents decoded to one latin1 string. It's either a single
 * stream or an array of streams that concatenate into one logical stream -
 * pdf-lib appends its own drawing as an extra array entry, so both cases
 * have to be handled to see everything painted on the page. */
function decodePageContent(page) {
  const raw = page.node.Contents();
  const contents = raw instanceof PDFArray || raw instanceof PDFRawStream ? raw : page.node.context.lookup(raw);
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)).filter((s) => s instanceof PDFRawStream)
      : contents instanceof PDFRawStream
        ? [contents]
        : [];
  const parts = streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()));
  const bytes = Buffer.concat(parts.flatMap((p, i) => (i === 0 ? [p] : [Buffer.from('\n'), p])));
  const text = bytes.toString('latin1');
  return { bytes: new Uint8Array(bytes), text, strings: showTextStrings(text) };
}

/** Every string a page's content stream shows, decoded. pdf-lib writes
 * text for the standard-14 fonts as hex (`<48656C6C6F> Tj`), not as a
 * literal `(Hello)`, so a plain substring search over the raw stream finds
 * nothing even when the text is right there.
 *
 * Note this only reads back single-byte encodings: text drawn in an
 * embedded (subset) font is a sequence of glyph indices, and recovering
 * characters from those needs the font's ToUnicode map - that's what
 * extractPageText below is for. */
function showTextStrings(streamText) {
  const out = [];
  for (const m of streamText.matchAll(/<([0-9A-Fa-f\s]+)>\s*(?:Tj|TJ|'|")/g)) {
    out.push(Buffer.from(m[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
  }
  for (const m of streamText.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|TJ|'|")/g)) {
    out.push(m[1].replace(/\\([()\\])/g, '$1'));
  }
  return out;
}

/** What a real PDF reader would show on a page - the check that actually
 * matters for "did the edit land", since it resolves embedded subset fonts
 * through their ToUnicode maps. */
async function extractPageText(bytes, pageNumber) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    // Without this pdf.js logs a warning for every standard-14 font it
    // wants metrics for; the files ship with the package.
    standardFontDataUrl: path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
  }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(' ');
  await doc.destroy();
  return text;
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules', '.bin', 'electron'),
    args: [root, '--no-sandbox', '--disable-gpu-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(800);

  const rendererErrors = [];
  win.on('pageerror', (e) => rendererErrors.push(String(e)));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(msg.text());
    if (msg.text().includes('[DEBUG]')) console.log('RENDERER:', msg.text());
  });

  await win.screenshot({ path: path.join(root, 'scratch-empty-state.png') });
  console.log('OK: app booted, empty state screenshot saved');

  assert((await win.locator('.titlebar').count()) === 1, 'custom frameless title bar rendered');
  assert((await win.locator('.menubar').count()) === 1, 'custom menu bar rendered');

  // main.js sets no native menu (frame:false hides it, and its
  // accelerators didn't reliably fire once hidden anyway - confirmed
  // empirically), so App.jsx's own keydown listener is the sole
  // accelerator source. Verify Ctrl+O actually reaches it.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      global.__ctrlOFired = true;
      return { canceled: true, filePaths: [] };
    };
  });
  await win.locator('.app').click({ position: { x: 400, y: 400 } });
  await win.keyboard.press('Control+O');
  await win.waitForTimeout(400);
  assert(await app.evaluate(() => !!global.__ctrlOFired), 'Ctrl+O opens the file dialog via the renderer-side accelerator handler');

  const pdfBytes = await makeTestPdf();
  const b64 = Buffer.from(pdfBytes).toString('base64');

  await app.evaluate(({ BrowserWindow }, dataB64) => {
    const win = BrowserWindow.getAllWindows()[0];
    const bytes = Buffer.from(dataB64, 'base64');
    win.webContents.send('file:openedExternally', {
      name: 'smoke-test.pdf',
      path: null,
      data: new Uint8Array(bytes)
    });
  }, b64);

  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(root, 'scratch-opened.png') });

  const canvasCount = await win.locator('.page-shell canvas').count();
  assert(canvasCount >= 1, `PDF rendered (${canvasCount} canvas(es))`);

  // --- select existing text by dragging, like any PDF viewer ------------
  // The page is 612x792pt; the headline sits at x=50, baseline y=700,
  // 24pt - so in top-left storage space it spans y 68..92. Convert to
  // screen through the live render scale.
  const shell0 = win.locator('.page-shell').first();
  const shell0Box = await shell0.boundingBox();
  const pageScale = shell0Box.width / 612;
  const atPage = (px, py) => ({ x: shell0Box.x + px * pageScale, y: shell0Box.y + py * pageScale });

  const textStart = atPage(55, 80);
  const textEnd = atPage(360, 80);
  await win.mouse.move(textStart.x, textStart.y);
  await win.mouse.down();
  await win.mouse.move(textEnd.x, textEnd.y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(250);

  assert(
    (await win.locator('.text-selection').count()) >= 1,
    'dragging across page text paints a selection highlight'
  );
  assert(
    (await win.locator('.text-selection-toolbar').count()) === 1,
    'a floating Edit text / Copy toolbar appears for the selection'
  );

  // --- Ctrl+C copies the real text through Electron's clipboard ---------
  await app.evaluate(({ clipboard }) => clipboard.writeText('__cleared__'));
  await win.keyboard.press('Control+C');
  await win.waitForTimeout(400);
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert(
    copied.includes('Smoke Test PDF'),
    `Ctrl+C copies the selected page text (got ${JSON.stringify(copied)})`
  );

  // --- "Edit text" turns the selection into an editable box -------------
  await win.locator('.text-selection-toolbar button', { hasText: 'Edit text' }).click();
  await win.waitForTimeout(400);
  let textareaCount = await win.locator('.page-overlay textarea.field').count();
  assert(textareaCount === 1, `"Edit text" opens exactly one inline editor (got ${textareaCount})`);

  // Replace the original wording, so the saved file can be checked for
  // both the new text and the absence of a cover rectangle.
  const inlineEditor = win.locator('.page-overlay textarea.field').first();
  await inlineEditor.fill('Replaced In Place');
  await inlineEditor.blur();
  await win.waitForTimeout(250);

  // Deselect (setTool('select') clears doc.selection).
  await win.locator('.tcbtn[title="Select"]').click();
  await win.waitForTimeout(150);

  // --- add a new text box, verify no viewer layout thrash ---------------
  // The properties panel is now a permanent fixture (contextual to the
  // active tool rather than only appearing on selection), so this guards
  // against a regression of the original reflow bug via a different path.
  const wrapBoxBefore = await win.locator('.viewer-wrap').boundingBox();
  await win.locator('.tcbtn[title="Text"]').click();
  await win.waitForTimeout(150);
  const wrapBoxAfterToolSelect = await win.locator('.viewer-wrap').boundingBox();
  assert(
    Math.abs(wrapBoxBefore.width - wrapBoxAfterToolSelect.width) < 1,
    'selecting a tool does not resize the viewer (no reflow/rescale glitch)'
  );

  const pageShell = win.locator('.page-shell').first();
  const box = await pageShell.boundingBox();
  await win.mouse.click(box.x + 100, box.y + 100);
  await win.waitForTimeout(300);
  textareaCount = await win.locator('textarea.field').count();
  assert(textareaCount > 0, 'new text box created and editable');
  await win.locator('.viewer-wrap').click({ position: { x: 10, y: 300 } });

  // --- draw a rectangle, confirm it stays put ---------------------------
  await win.locator('.tcbtn[title="Rectangle"]').click();
  await win.mouse.move(box.x + 150, box.y + 150);
  await win.mouse.down();
  await win.mouse.move(box.x + 250, box.y + 200, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(200);
  await win.locator('.rail-btn[title="Layers"]').click();
  await win.waitForTimeout(200);
  const layerCount = await win.locator('.layer-row').count();
  assert(layerCount >= 2, `Layers panel lists created objects (${layerCount})`);

  // --- ellipse ---------------------------------------------------------
  await win.locator('.tcbtn[title="Ellipse"]').click();
  await win.mouse.move(box.x + 300, box.y + 150);
  await win.mouse.down();
  await win.mouse.move(box.x + 400, box.y + 220, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(200);
  assert(
    (await win.locator('.layer-row', { hasText: 'Ellipse' }).count()) === 1,
    'ellipse tool creates an ellipse object'
  );

  // --- arrow: preview head must be a real polygon, not a shared <marker>.
  // Two arrows in different colors used to collide on a single marker id
  // ("arrowhead"), so both rendered with the first one's color.
  await win.locator('.tcbtn[title="Arrow"]').click();
  await win.mouse.move(box.x + 150, box.y + 300);
  await win.mouse.down();
  await win.mouse.move(box.x + 320, box.y + 360, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  assert(
    (await win.locator('.page-overlay svg polygon').count()) >= 1,
    'arrow renders a solid polygon arrowhead'
  );
  assert(
    (await win.locator('.page-overlay svg marker').count()) === 0,
    'arrow uses no shared-id SVG marker'
  );

  // --- image: one click on the toolbar button inserts it ---------------
  const imgPath = path.join(os.tmpdir(), `smoke-img-${Date.now()}.png`);
  // 4x4 red PNG
  await fs.writeFile(
    imgPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64'
    )
  );
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, imgPath);
  assert((await win.locator('.page-overlay img').count()) === 0, 'no image on the page before inserting');
  await win.locator('.tcbtn[title="Insert an image (PNG/JPG)"]').click();
  await win.waitForTimeout(1000);
  assert(
    (await win.locator('.page-overlay img').count()) === 1,
    'a single Image-button click inserts an image (no second click needed)'
  );

  // --- mislabeled image: real JPEG bytes under a .png filename ----------
  // A file's extension can lie (renamed files, chat-app downloads, ...);
  // the live preview never cared (the browser sniffs actual content for
  // <img>), but the save path used to trust the extension-derived MIME
  // blindly and crash with an unhelpful "Save failed: undefined" once
  // pdf-lib tried to parse JPEG bytes as PNG. placeImage.js now sniffs the
  // real magic bytes instead.
  const jpegAsPngPath = path.join(os.tmpdir(), `smoke-mislabeled-${Date.now()}.png`);
  const tinyJpegB64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
  await fs.writeFile(jpegAsPngPath, Buffer.from(tinyJpegB64, 'base64'));
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, jpegAsPngPath);
  await win.locator('.tcbtn[title="Insert an image (PNG/JPG)"]').click();
  await win.waitForTimeout(1000);
  assert(
    (await win.locator('.page-overlay img').count()) === 2,
    'a JPEG mislabeled with a .png extension still inserts (sniffed by content, not trusted by name)'
  );

  // --- Add Form Field tool: draw one, retype it, save as a real AcroForm field
  await win.locator('.tcbtn[title="Field"]').click();
  await win.mouse.move(box.x + 60, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x + 260, box.y + 230, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  await win.locator('.tcbtn[title="Select"]').click();
  await win.mouse.click(box.x + 160, box.y + 215);
  await win.waitForTimeout(250);
  assert((await win.locator('.pp-header-chip', { hasText: 'Form Field' }).count()) === 1, 'Field tool creates a selectable Form Field with its own properties');
  const fieldNameInput = win.locator('.properties-panel input.field').first();
  await fieldNameInput.fill('SmokeTestField');
  await fieldNameInput.blur();
  await win.waitForTimeout(150);
  const fieldValueInput = win.locator('.properties-panel input.field').nth(1);
  await fieldValueInput.fill('hello field');
  await win.waitForTimeout(150);

  await win.screenshot({ path: path.join(root, 'scratch-after-edits.png') });

  // --- real Save As, via a monkey-patched dialog so no UI is needed ----
  const savePath = path.join(os.tmpdir(), `smoke-save-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, savePath);

  // Save As lives in the File menu now (the toolbar only keeps Open/Save/
  // Export per the redesign), so drive it through the custom menu bar.
  await win.locator('.menubar-item', { hasText: 'File' }).click();
  await win.locator('.menubar-dropdown-item', { hasText: 'Save As...' }).click();
  await win.waitForTimeout(1000);

  const toastText = await win.locator('.toast').textContent().catch(() => null);
  if (toastText && /failed/i.test(toastText)) {
    throw new Error(`FAIL: save reported an error: ${toastText}`);
  }

  const saved = await fs.readFile(savePath).catch(() => null);
  assert(!!saved, 'save produced a file on disk');
  assert(saved.subarray(0, 5).toString('latin1') === '%PDF-', 'saved file has a valid PDF header');
  assert(saved.length > 500, `saved file is a plausible size (${saved.length} bytes)`);

  // Re-open the saved file to make sure it's actually a loadable PDF, not
  // just header bytes followed by garbage.
  const reloaded = await PDFDocument.load(saved);
  assert(reloaded.getPageCount() === 2, 'saved PDF reloads with the correct page count');
  assert(
    saved.toString('latin1').includes('/Image'),
    'saved PDF embeds the inserted image as an XObject'
  );

  // --- the edited text was hidden in the content stream, not covered ----
  // This is the whole point of the in-place edit: the original glyphs are
  // switched to text rendering mode 3 (invisible) right where they were
  // drawn, so the replacement lands on genuinely empty page - no white
  // rectangle in a guessed background color, which is what used to make an
  // edit look pasted-on over anything but a flat background.
  const page1 = decodePageContent(reloaded.getPages()[0]);
  assert(
    / 3 Tr /.test(page1.text),
    'the edited run was switched to invisible text mode in the page content stream'
  );
  // The replacement is drawn as an additional text op rather than
  // replacing the original in situ - the original is kept, just invisible,
  // so every following advance and position in that text object stays
  // bit-identical.
  assert(
    page1.strings.includes('Smoke Test PDF - Hello World'),
    'the original run is still present in the stream, just invisible - nothing after it can shift'
  );
  const savedPageText = await extractPageText(saved, 1);
  assert(
    savedPageText.includes('Replaced In Place'),
    `a PDF reader sees the replacement text on the page (got ${JSON.stringify(savedPageText)})`
  );
  // The cover rectangle is filled with the sampled background color, which
  // on this white test page is white. Its absence is the actual payoff:
  // nothing is painted over the page to hide the old glyphs.
  assert(
    !/\b1 1 1 rg\b/.test(page1.text),
    'no white cover rectangle was painted over the original text'
  );

  const bakedField = reloaded.getForm().getFieldMaybe('SmokeTestField');
  assert(!!bakedField, 'the Field tool baked a real "SmokeTestField" AcroForm field');
  assert(bakedField.constructor.name === 'PDFTextField', `it is a real text field (got ${bakedField?.constructor?.name})`);
  assert(bakedField.getText() === 'hello field', `its test value round-tripped (got ${JSON.stringify(bakedField?.getText())})`);

  // --- text the built-in fonts can't encode still saves ------------------
  // The 14 base PDF fonts are limited to WinAnsi; pdf-lib refuses to guess
  // and throws on anything outside it, which used to abort the whole save
  // over one character. Those characters are now substituted and reported.
  await win.locator('.tcbtn[title="Text"]').click();
  await win.mouse.click(box.x + 100, box.y + 520);
  await win.waitForTimeout(300);
  const unicodeBox = win.locator('.page-overlay textarea.field').first();
  await unicodeBox.fill('arrow → and Ж');
  await unicodeBox.blur();
  await win.locator('.tcbtn[title="Select"]').click();
  await win.waitForTimeout(200);

  const unicodePath = path.join(os.tmpdir(), `smoke-unicode-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, unicodePath);
  await win.locator('.menubar-item', { hasText: 'File' }).click();
  await win.locator('.menubar-dropdown-item', { hasText: 'Save As...' }).click();
  await win.waitForTimeout(1200);

  const unicodeSaved = await fs.readFile(unicodePath).catch(() => null);
  assert(!!unicodeSaved, 'a document containing non-WinAnsi characters still saves');
  const unicodePage = decodePageContent((await PDFDocument.load(unicodeSaved)).getPages()[0]);
  assert(
    unicodePage.strings.includes('arrow -> and ?'),
    `unencodable characters are substituted, not dropped or fatal (found ${JSON.stringify(unicodePage.strings)})`
  );
  await fs.unlink(unicodePath).catch(() => {});

  // --- unsaved changes are never discarded silently ---------------------
  // The save above cleared the dirty flag, so make a fresh edit and then
  // try to close: both the tab's X and the window's close button must stop
  // and ask rather than throwing the work away.
  await win.locator('.tcbtn[title="Rectangle"]').click();
  await win.mouse.move(box.x + 60, box.y + 400);
  await win.mouse.down();
  await win.mouse.move(box.x + 160, box.y + 450, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  assert((await win.locator('.doctab-dirty').count()) === 1, 'a new edit marks the document dirty');

  await win.locator('.doctab-close').first().click();
  await win.waitForTimeout(400);
  assert(
    (await win.locator('.modal', { hasText: 'Unsaved changes' }).count()) === 1,
    'closing a tab with unsaved edits asks before discarding them'
  );
  await win.locator('.modal button', { hasText: 'Cancel' }).click();
  await win.waitForTimeout(200);
  assert((await win.locator('.doctab').count()) === 1, 'cancelling keeps the document open');

  // The window close goes through the main process, which must veto the
  // close and hand it back to the renderer to ask.
  await win.locator('.winctl.close').click();
  await win.waitForTimeout(500);
  assert(
    (await win.locator('.modal', { hasText: 'Unsaved changes' }).count()) === 1,
    'closing the window with unsaved edits asks before discarding them'
  );
  assert((await app.windows()).length === 1, 'the window is still open while the prompt is up');
  // Discard actually closes the window, which tears the page down mid-click
  // - Playwright reports that as an error even though the click landed.
  await win
    .locator('.modal button', { hasText: 'Discard' })
    .click({ noWaitAfter: true })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  assert((await app.windows()).length === 0, 'discarding closes the window');

  await fs.unlink(savePath).catch(() => {});
  await fs.unlink(imgPath).catch(() => {});
  await fs.unlink(jpegAsPngPath).catch(() => {});

  await app.close().catch(() => {
    /* "Discard" already closed the window */
  });

  if (rendererErrors.length) {
    console.error('Renderer errors seen during the run:', rendererErrors);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed, no renderer errors.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
