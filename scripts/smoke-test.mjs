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
import { PDFDocument, StandardFonts } from 'pdf-lib';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

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

  // --- click-to-edit existing text -----------------------------------
  await win.locator('.text-hit-target').first().click();
  await win.waitForTimeout(300);
  let textareaCount = await win.locator('textarea.field').count();
  assert(textareaCount > 0, 'clicking existing PDF text opens an inline editor');

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

  await fs.unlink(savePath).catch(() => {});
  await fs.unlink(imgPath).catch(() => {});
  await fs.unlink(jpegAsPngPath).catch(() => {});

  await app.close();

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
