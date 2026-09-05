import pdfjsLib from './pdfjsSetup';

/**
 * Extracts every text run on a page (position + size in storage space, plus
 * an auto-detected font family/size/color) so the viewer can offer text
 * selection and "edit this text in place".
 *
 * Each run also carries the index of the content-stream operator that drew
 * it, which is what lets the save path make the original glyphs genuinely
 * invisible (see pdf/contentStreamText.js) rather than hiding them under a
 * rectangle in a guessed background color. The cover rectangle is still
 * kept on the annotation as a fallback for the cases where that operator
 * mapping can't be trusted - see `indexAligned` below.
 */

function u8ToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Walks the page's low-level drawing operators to recover each showText
 * call's actual fill color (RGB/Gray/CMYK), in the same order textContent
 * items are produced - much more reliable than sampling rendered pixels,
 * which is noisy for small/anti-aliased text. */
async function extractTextColorsInOrder(pdfPage) {
  const { OPS } = pdfjsLib;
  const opList = await pdfPage.getOperatorList();
  const colors = [];
  let current = [0, 0, 0];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    switch (fn) {
      case OPS.setFillRGBColor:
        current = [args[0], args[1], args[2]];
        break;
      case OPS.setFillGray: {
        const g = args[0] * 255;
        current = [g, g, g];
        break;
      }
      case OPS.setFillCMYKColor: {
        const [c, m, y, k] = args;
        current = [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
        break;
      }
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText:
        colors.push(u8ToHex(current[0], current[1], current[2]));
        break;
      default:
        break;
    }
  }
  return colors;
}

/** Best-effort lookup of the PDF's actual (embedded or standard-14) font
 * name for a pdf.js internal font id, e.g. "ArialMT" or "Calibri-Bold" -
 * pdf.js's public textContent API only gives a generic CSS fallback
 * family, not this. Only available once the font has actually been
 * loaded (during/after a render), so this can legitimately come back
 * empty - callers must fall back gracefully. */
function tryGetRealFontName(pdfPage, fontId) {
  try {
    if (pdfPage.commonObjs && pdfPage.commonObjs.has(fontId)) {
      const fontObj = pdfPage.commonObjs.get(fontId);
      return fontObj?.name || fontObj?.fallbackName || null;
    }
  } catch {
    /* font not loaded yet - fine, caller falls back */
  }
  return null;
}

/**
 * @returns {Promise<{runs: Array, textOpCount: number, indexAligned: boolean}>}
 *   `indexAligned` says whether each run's `opIndex` can be trusted to
 *   identify the matching text-showing operator in the page's content
 *   stream. pdf.js builds getTextContent() items with its own
 *   merge/split heuristics, so they are only guaranteed to line up 1:1
 *   with show-text operators when the two counts agree - and editing the
 *   wrong glyphs is far worse than falling back, so this is checked
 *   rather than assumed.
 */
export async function extractTextRuns(pdfPage) {
  const textContent = await pdfPage.getTextContent();
  const viewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
  const colors = await extractTextColorsInOrder(pdfPage).catch(() => []);
  const textOpCount = colors.length;
  const indexAligned = textOpCount === textContent.items.length;
  const runs = [];

  let i = 0;
  // textContent.items and the operator list's showText-family calls are
  // both produced by a single linear walk of the same content stream, so
  // - for the vast majority of real-world PDFs - they line up 1:1 in
  // order, including whitespace-only items. Advance through `colors` in
  // lockstep with every item (not just the ones we keep) so that
  // alignment holds.
  for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
    const item = textContent.items[itemIndex];
    const color = colors[itemIndex] || '#000000';
    if (!item.str || !item.str.trim()) continue;
    // item.transform = [a, b, c, d, tx, ty]: (a,b) is the (fontSize-scaled)
    // horizontal glyph-space basis vector, (c,d) the vertical one, (tx,ty)
    // the baseline origin - all still in PDF user space (untouched by the
    // viewport). item.width is the string's total advance along (a,b).
    const [a, b, c, d, tx, ty] = item.transform;
    const fontHeight = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const width = item.width || fontHeight * item.str.length * 0.5;
    const hLen = Math.hypot(a, b) || 1;
    const vLen = Math.hypot(c, d) || fontHeight;
    const hx = a / hLen, hy = b / hLen;
    const vx = c / vLen || 0, vy = d / vLen || 1;

    const corners = [
      [tx, ty],
      [tx + hx * width, ty + hy * width],
      [tx + vx * fontHeight, ty + vy * fontHeight],
      [tx + hx * width + vx * fontHeight, ty + hy * width + vy * fontHeight]
    ].map(([px, py]) => viewport.convertToViewportPoint(px, py));

    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(6, Math.max(...xs) - x);
    const h = Math.max(6, Math.max(...ys) - y);

    const style = textContent.styles?.[item.fontName];
    const realFontName = tryGetRealFontName(pdfPage, item.fontName);
    runs.push({
      id: `run-${i++}`,
      str: item.str,
      // Which text-showing operator drew this run, so the save path can
      // make exactly those glyphs invisible instead of covering them.
      opIndex: indexAligned ? itemIndex : null,
      rect: { x, y, w, h },
      fontSize: Math.round(fontHeight * 100) / 100,
      fontFamilyHint: style?.fontFamily || '',
      realFontName,
      bold: /bold/i.test(realFontName || '') || (style && /bold/i.test(style.fontFamily || '')),
      italic: /italic|oblique/i.test(realFontName || ''),
      color
    });
  }
  return { runs, textOpCount, indexAligned };
}

/** Map a pdf.js font-family hint to one of our embeddable standard fonts.
 * Used only as the last-resort fallback when no real font name could be
 * recovered and/or a matching Google Font couldn't be fetched. */
export function guessStandardFamily(hint) {
  const h = (hint || '').toLowerCase();
  if (h.includes('courier') || h.includes('mono')) return 'Courier';
  // "sans-serif" contains "serif" as a substring, so sans-serif fonts have
  // to be excluded explicitly or they'd wrongly map to a serif fallback.
  if (!h.includes('sans') && (h.includes('times') || h.includes('serif') || h.includes('georgia') || h.includes('garamond'))) {
    return 'TimesRoman';
  }
  return 'Helvetica';
}
