/**
 * Tests for pdf/contentStreamText.js - the module that makes an edited
 * run's original glyphs genuinely invisible in the page's content stream,
 * so a replacement can be drawn on empty space instead of on a rectangle
 * painted in a guessed background color.
 *
 * Two halves:
 *  1. Structural - the tokenizer must never mistake string, hex-string,
 *     comment or inline-image payload for an operator, because hiding the
 *     wrong operator silently corrupts the page.
 *  2. Visual - render the page before and after with real pdf.js and count
 *     dark pixels per horizontal band. That's the only check that actually
 *     proves the claim: the edited line's glyphs are gone, and every other
 *     line is pixel-identical (nothing shifted).
 *
 * Run with: node scripts/text-surgery-test.mjs
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  tokenizeOperators,
  countTextShowingOps,
  hideTextOps,
  canEditTextInPlace
} from '../src/renderer/pdf/contentStreamText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

const enc = (s) => new TextEncoder().encode(s);
const opNames = (src) => tokenizeOperators(enc(src)).map((o) => o.op).join(',');

// --- tokenizer unit checks -------------------------------------------------
assert(opNames('BT /F1 12 Tf (Hello) Tj ET') === 'BT,Tf,Tj,ET', 'a simple text object tokenizes');
assert(
  opNames('BT (Tj ET \\) BT) Tj ET') === 'BT,Tj,ET',
  'operator lookalikes inside a literal string are not tokenized'
);
assert(opNames('BT <48656C6C6F> Tj ET') === 'BT,Tj,ET', 'hex strings tokenize');
assert(opNames('[(a) -250 (b)] TJ') === 'TJ', 'TJ arrays tokenize');
assert(opNames('% comment with (Tj\nBT (x) Tj ET') === 'BT,Tj,ET', 'comments are skipped');
assert(opNames('/Name1 5 0 obj << /A /B >> Tf') === 'obj,Tf', 'names and dictionaries are not operators');

{
  // An inline image's binary payload can contain literally anything,
  // including the bytes "Tj" - it must be skipped wholesale to EI.
  const src = 'q BI /W 2 /H 2 ID \x00Tj\x01\xff EI Q BT (real) Tj ET';
  assert(opNames(src) === 'q,BI,ID,EI,Q,BT,Tj,ET', 'inline-image binary is skipped');
  assert(countTextShowingOps(enc(src)) === 1, 'only the real Tj is counted as text-showing');
}

{
  // `3 Tr` has to be injected where the operands start, never between an
  // operator's operands and the operator itself.
  const ops = tokenizeOperators(enc('BT /F1 12 Tf 10 20 Td (Hi) Tj ET'));
  const tj = ops.find((o) => o.op === 'Tj');
  const td = ops.find((o) => o.op === 'Td');
  assert(tj.argStart === td.end, "a text op's argStart is exactly the end of the previous operator");
}

// --- end-to-end surgery on a real pdf-lib document -------------------------
async function buildSample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText('FIRST LINE', { x: 40, y: 150, size: 18, font });
  page.drawText('SECOND LINE', { x: 40, y: 110, size: 18, font });
  page.drawText('THIRD LINE', { x: 40, y: 70, size: 18, font });
  return doc.save();
}

const original = await buildSample();
const doc = await PDFDocument.load(original);
const page = doc.getPages()[0];

assert(canEditTextInPlace(page, 3), 'canEditTextInPlace agrees there are 3 text-showing ops');
assert(!canEditTextInPlace(page, 4), 'canEditTextInPlace rejects a mismatched count');

const hidden = hideTextOps(page, [1]); // hide "SECOND LINE"
assert(hidden instanceof Set, 'hideTextOps reports which indices it actually hid');
assert(hidden.size === 1 && hidden.has(1), `exactly the requested operator was hidden (${[...hidden]})`);

const edited = await doc.save();
const reloaded = await PDFDocument.load(edited);
assert(reloaded.getPageCount() === 1, 'the edited PDF still loads');
assert(
  canEditTextInPlace(reloaded.getPages()[0], 3),
  'the rewritten stream still has 3 text-showing ops (hidden, not deleted)'
);

// --- visual proof ----------------------------------------------------------
const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox']
});
const tab = await browser.newPage({ viewport: { width: 500, height: 300 } });
await tab.setContent('<canvas id="c"></canvas>');
await tab.addScriptTag({ content: await fs.readFile(path.join(root, 'node_modules/pdfjs-dist/build/pdf.js'), 'utf8') });
await tab.evaluate((ws) => {
  const blob = new Blob([ws], { type: 'application/javascript' });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
}, await fs.readFile(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.js'), 'utf8'));

const render = (bytes) =>
  tab.evaluate(async (arr) => {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 2 });
    const c = document.getElementById('c');
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    // Dark pixels per horizontal band, so each line compares independently.
    const bands = [];
    const bandHeight = Math.floor(height / 4);
    for (let band = 0; band < 4; band++) {
      let dark = 0;
      for (let y = band * bandHeight; y < (band + 1) * bandHeight; y++) {
        for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 128) dark++;
      }
      bands.push(dark);
    }
    return { bands, width, height };
  }, Array.from(bytes));

const before = await render(original);
const after = await render(edited);
console.log('dark pixels per band before:', JSON.stringify(before.bands));
console.log('dark pixels per band  after:', JSON.stringify(after.bands));

assert(before.width === after.width && before.height === after.height, 'page size unchanged');
assert(before.bands[0] > 100 && before.bands[1] > 100 && before.bands[2] > 100, 'sanity: all three lines rendered before the edit');
assert(after.bands[1] === 0, `the hidden run's glyphs are completely gone (${after.bands[1]} dark pixels remain)`);
assert(after.bands[0] === before.bands[0], `the line above is pixel-identical (${before.bands[0]} -> ${after.bands[0]})`);
assert(after.bands[2] === before.bands[2], `the line below is pixel-identical - nothing shifted (${before.bands[2]} -> ${after.bands[2]})`);

await browser.close();
console.log('\nAll content-stream text-surgery checks passed.');
