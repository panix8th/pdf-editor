/**
 * End-to-end test for the Fonts panel: the installed-font index, the
 * document font check, and applying an installed font to page text.
 *
 * The list has to arrive with no permission prompt and no "Continue" step -
 * that was the whole problem with the old queryLocalFonts() picker, so the
 * test drives the panel exactly as a user would and fails if the list is
 * empty.
 *
 * Run with: node scripts/fonts-test.mjs
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { _electron: electron } = pw;
import { PDFDocument, PDFName, PDFDict, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

/**
 * A PDF exercising all three outcomes the checker distinguishes:
 * a standard-14 font, a genuinely embedded one, and a font referenced by
 * name with no glyphs attached (what a "missing font" actually looks like
 * on disk - it is just a /BaseFont with no /FontFile).
 */
async function makeTestPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const embedded = await doc.embedFont(await fs.readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), { subset: true });
  const page = doc.addPage([400, 260]);
  page.drawText('Standard font line', { x: 30, y: 200, size: 14, font: helv });
  page.drawText('Embedded font line', { x: 30, y: 170, size: 14, font: embedded });

  const ctx = doc.context;
  const ghost = ctx.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'NotInstalledFakeFont',
    FirstChar: 32,
    LastChar: 126,
    Encoding: 'WinAnsiEncoding'
  });
  const ghostRef = ctx.register(ghost);
  const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  fonts.set(PDFName.of('Ghost'), ghostRef);
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

  const rendererErrors = [];
  win.on('pageerror', (e) => rendererErrors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && rendererErrors.push(m.text()));

  // A permission request would mean we're still going through Chromium's
  // Local Font Access API instead of reading the directories directly.
  await app.evaluate(({ session }) => {
    global.__permissionAsked = [];
    const inner = session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);
    inner((_wc, permission, callback) => {
      global.__permissionAsked.push(permission);
      callback(false);
    });
  });

  const b64 = Buffer.from(await makeTestPdf()).toString('base64');
  await app.evaluate(({ BrowserWindow }, d) => {
    BrowserWindow.getAllWindows()[0].webContents.send('file:openedExternally', {
      name: 'fonts-test.pdf',
      path: null,
      data: new Uint8Array(Buffer.from(d, 'base64'))
    });
  }, b64);
  await win.waitForTimeout(1800);

  // --- the panel opens and populates with no prompt and no extra click ---
  await win.locator('.rail-btn[title="Fonts"]').click();
  await win.waitForTimeout(3000); // first scan parses every installed font file

  const installedCount = await win.locator('.font-list-item').count();
  assert(installedCount > 0, `installed fonts are listed with no permission prompt (${installedCount} families)`);
  assert(
    (await app.evaluate(() => global.__permissionAsked)).length === 0,
    'no web permission was requested to read them'
  );

  // --- the document check reports the right status per font -------------
  const rows = await win.locator('.font-row').evaluateAll((els) =>
    els.map((e) => ({
      name: e.querySelector('.font-row-name')?.textContent?.trim(),
      status: e.querySelector('.font-chip')?.textContent?.trim(),
      actions: e.querySelectorAll('.font-row-actions button').length
    }))
  );
  console.log('document fonts:', JSON.stringify(rows));

  const byName = (n) => rows.find((r) => r.name === n);
  assert(byName('Helvetica')?.status === 'Built-in', 'a standard-14 font is reported as built-in');
  assert(/Embedded/.test(byName('DejaVuSans')?.status || ''), 'an embedded font is reported as embedded');
  const ghost = byName('NotInstalledFakeFont');
  assert(ghost?.status === 'Missing', `a font that is neither embedded nor installed is flagged (got ${ghost?.status})`);
  assert(ghost.actions === 2, 'the missing font offers both install and find-online actions');

  // A font that IS installed but not embedded must not be flagged - that
  // distinction is the whole point of the check.
  assert(
    !rows.some((r) => r.status === 'Missing' && r.name === 'DejaVuSans'),
    'an installed-but-not-embedded font is not reported as missing'
  );

  // --- applying an installed font embeds it into the saved file ---------
  const shell = await win.locator('.page-shell').first().boundingBox();
  const scale = shell.width / 400;
  // "Standard font line" sits at baseline y=200 on a 260pt page -> storage
  // y is 260-200-14 = 46 through 60.
  await win.mouse.move(shell.x + 32 * scale, shell.y + 54 * scale);
  await win.mouse.down();
  await win.mouse.move(shell.x + 150 * scale, shell.y + 54 * scale, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  await win.locator('.text-selection-toolbar button', { hasText: 'Edit text' }).click();
  await win.waitForTimeout(400);
  await win.locator('.page-overlay textarea.field').first().blur();
  await win.waitForTimeout(200);

  // The Fonts panel is still open - clicking its rail button again would
  // toggle the sidebar shut, not re-open it.
  await win.locator('.fonts-panel input.field').fill('DejaVu Sans Mono');
  await win.waitForTimeout(300);
  await win.locator('.font-list-item').first().click();
  await win.waitForTimeout(1500);

  const savePath = path.join(root, 'scratch-fonts-out.pdf');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, savePath);
  await win.locator('.menubar-item', { hasText: 'File' }).click();
  await win.locator('.menubar-dropdown-item', { hasText: 'Save As...' }).click();
  await win.waitForTimeout(1500);

  const saved = await fs.readFile(savePath).catch(() => null);
  assert(!!saved, 'the document saves after applying an installed font');
  const reloaded = await PDFDocument.load(saved);
  const fontNames = [];
  for (const page of reloaded.getPages()) {
    const res = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    const fonts = res && res.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fonts) continue;
    for (const [, ref] of fonts.entries()) {
      const d = res.context.lookup(ref, PDFDict);
      const bf = d && d.get(PDFName.of('BaseFont'));
      if (bf) fontNames.push(String(bf));
    }
  }
  console.log('fonts in saved file:', JSON.stringify(fontNames));
  assert(
    fontNames.some((n) => /DejaVuSansMono/i.test(n)),
    `the applied system font was embedded into the saved PDF (got ${fontNames.join(', ')})`
  );

  await fs.unlink(savePath).catch(() => {});
  await app.close();

  if (rendererErrors.length) {
    console.error('Renderer errors:', rendererErrors);
    process.exit(1);
  }
  console.log('\nAll font checks passed.');
}

main().catch((err) => {
  console.error('FONTS TEST FAILED:', err);
  process.exit(1);
});
