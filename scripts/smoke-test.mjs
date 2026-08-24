/**
 * Headless smoke test: launches the packaged Electron app under Xvfb via
 * Playwright, opens a generated test PDF (by simulating the "opened
 * externally" IPC path so we don't have to drive a native file dialog),
 * exercises a few core interactions, and saves screenshots for visual
 * inspection. Not a full test suite - just enough to catch "the app
 * doesn't even boot" / "the renderer throws on mount" class of bugs.
 *
 * Run with: node scripts/smoke-test.mjs
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { _electron: electron } = pw;
import { PDFDocument, StandardFonts } from 'pdf-lib';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function makeTestPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Smoke Test PDF - Hello World', { x: 50, y: 700, size: 24, font });
  page.setTitle && page.setTitle;
  doc.setTitle('Smoke Test');
  const outline = doc.addPage([612, 792]);
  outline.drawText('Second page', { x: 50, y: 700, size: 24, font });
  return doc.save();
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

  await win.screenshot({ path: path.join(root, 'scratch-empty-state.png') });
  console.log('OK: app booted, empty state screenshot saved');

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
  console.log('OK: PDF opened, screenshot saved');

  const canvasCount = await win.locator('.page-shell canvas').count();
  console.log('Rendered canvases:', canvasCount);
  if (canvasCount < 1) throw new Error('FAIL: no page canvas rendered');

  // Add a text box via the toolbar + click on the page.
  await win.getByTitle('Text').click();
  const pageShell = win.locator('.page-shell').first();
  const box = await pageShell.boundingBox();
  await win.mouse.click(box.x + 100, box.y + 100);
  await win.waitForTimeout(300);
  const textBoxCount = await win.locator('textarea.field').count();
  console.log('Text edit box present:', textBoxCount > 0);

  await win.screenshot({ path: path.join(root, 'scratch-textbox.png') });

  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  await win.waitForTimeout(300);

  await app.close();

  if (errors.length) {
    console.error('Renderer errors seen:', errors);
    process.exit(1);
  }
  console.log('\nSmoke test finished without renderer crashes.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
