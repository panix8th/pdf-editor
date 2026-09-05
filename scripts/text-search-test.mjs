/**
 * Tests for pdf/textSearch.js against real pdf.js output.
 *
 * The case that matters: pdf.js splits a page's text into "items" on its
 * own terms, and a single visual line is routinely several of them - so a
 * multi-word query straddles an item boundary far more often than not.
 * Searching item by item (the obvious implementation) silently finds
 * nothing for those, which reads to the user as "this PDF isn't
 * searchable".
 *
 * Run with: node scripts/text-search-test.mjs
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import path from 'path';
import { fileURLToPath } from 'url';
// The legacy build is CommonJS, so its API hangs off the default export.
import pdfjsModule from 'pdfjs-dist/legacy/build/pdf.js';
import { searchDocument } from '../src/renderer/pdf/textSearch.js';

const pdfjs = pdfjsModule.default || pdfjsModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

async function buildSample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([400, 200]);
  // Two draws on the same baseline: pdf.js reports these as separate text
  // items, so "quick brown" spans the boundary between them.
  page1.drawText('The quick ', { x: 40, y: 150, size: 14, font });
  page1.drawText('brown fox', { x: 110, y: 150, size: 14, font });
  page1.drawText('jumps over', { x: 40, y: 120, size: 14, font });
  const page2 = doc.addPage([400, 200]);
  page2.drawText('the lazy dog', { x: 40, y: 150, size: 14, font });
  return doc.save();
}

const bytes = await buildSample();
const pdfjsDoc = await pdfjs.getDocument({
  data: new Uint8Array(bytes),
  isEvalSupported: false,
  standardFontDataUrl: path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
}).promise;

// Sanity: confirm the fixture really does split the line, or the headline
// test below would pass for the wrong reason.
const items = (await (await pdfjsDoc.getPage(1)).getTextContent()).items;
assert(items.length > 1, `the fixture's first line really is split into several pdf.js items (${items.length})`);

assert((await searchDocument(pdfjsDoc, '')).length === 0, 'an empty query matches nothing');
assert((await searchDocument(pdfjsDoc, '   ')).length === 0, 'a whitespace-only query matches nothing');

const single = await searchDocument(pdfjsDoc, 'quick');
assert(single.length === 1, `a word within one item is found once (${single.length})`);
assert(single[0].pageNumber === 1, 'it reports the right page');
assert(single[0].rect.w > 0 && single[0].rect.h > 0, 'it has a usable highlight rectangle');

const spanning = await searchDocument(pdfjsDoc, 'quick brown');
assert(spanning.length === 1, `a phrase spanning several pdf.js items is found (${spanning.length})`);
// One rect per item the match touches - pdf.js emits whitespace-only
// items of its own, so the exact count is its business, not ours.
assert(spanning[0].rects.length >= 2, `it highlights every item it covers (${spanning[0].rects.length} rects)`);
assert(
  spanning[0].rects.every((r) => r.w > 0 && r.h > 0),
  'every rect is non-degenerate'
);
assert(
  spanning[0].rects.every((r) => Math.abs(r.y - spanning[0].rects[0].y) < 2),
  'the rects sit on one line, so together they read as a single highlight'
);

const otherPage = await searchDocument(pdfjsDoc, 'lazy dog');
assert(otherPage.length === 1 && otherPage[0].pageNumber === 2, 'matches on later pages report their own page number');

const caseInsensitive = await searchDocument(pdfjsDoc, 'QUICK BROWN');
assert(caseInsensitive.length === 1, 'search is case-insensitive');

const missing = await searchDocument(pdfjsDoc, 'not in this document');
assert(missing.length === 0, 'a query that is not present matches nothing');

// "the" appears in "The quick" (page 1) and "the lazy dog" (page 2); the
// one inside "over" must not count, and neither should overlapping starts.
const repeated = await searchDocument(pdfjsDoc, 'the');
assert(repeated.length === 2, `every occurrence is reported exactly once (${repeated.length})`);

assert(
  spanning[0].snippet.includes('quick brown'),
  `the snippet shows the match in context (got ${JSON.stringify(spanning[0].snippet)})`
);

await pdfjsDoc.destroy();
console.log('\nAll text-search checks passed.');
