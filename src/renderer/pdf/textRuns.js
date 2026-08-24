/**
 * Extracts every text run on a page (position + size in storage space, plus
 * a best-effort font family/size guess) so the viewer can offer "click
 * existing text to edit it." pdf-lib/PDF in general has no supported way to
 * truly rewrite a content stream's text in place, so editing works by
 * covering the original run with a sampled background color and drawing
 * the edited text on top (see AnnotationLayer's text-hit layer and
 * documentIO's `coverRect` handling) - the same cover-and-replace approach
 * used for redaction, just without permanently flattening the page.
 */
export async function extractTextRuns(pdfPage) {
  const textContent = await pdfPage.getTextContent();
  const viewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
  const runs = [];

  let i = 0;
  for (const item of textContent.items) {
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
    runs.push({
      id: `run-${i++}`,
      str: item.str,
      rect: { x, y, w, h },
      fontSize: Math.round(fontHeight * 100) / 100,
      fontFamilyHint: style?.fontFamily || ''
    });
  }
  return runs;
}

/** Map a pdf.js font-family hint to one of our embeddable standard fonts. */
export function guessStandardFamily(hint) {
  const h = (hint || '').toLowerCase();
  if (h.includes('courier') || h.includes('mono')) return 'Courier';
  if (h.includes('times') || h.includes('serif') || h.includes('georgia') || h.includes('garamond')) return 'TimesRoman';
  return 'Helvetica';
}
