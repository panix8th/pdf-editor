/**
 * Full-text search across every page of a pdf.js document. Returns matches
 * with page number + one or more bounding rects in storage space
 * (unrotated, scale 1, top-left origin) so the viewer can draw highlights.
 *
 * pdf.js hands back text in "items", which are chunks of a content stream's
 * show-text operators - a single visual line is routinely split into
 * several, and a word can straddle the boundary. So the page's items are
 * concatenated into one string first and the query is matched against
 * that; each match is then mapped back onto whichever items it covers.
 * Searching item-by-item (the obvious approach) silently misses any phrase
 * that happens to be split, which for multi-word queries is most of them.
 */

/** Where one item's text lands in the concatenated page string, plus the
 * geometry needed to turn a character range back into a rectangle. */
function buildPageIndex(textContent, viewport) {
  let text = '';
  const spans = [];

  for (const item of textContent.items) {
    if (typeof item.str !== 'string') continue;
    if (item.str.length === 0) {
      // A zero-length item still carries pdf.js's end-of-line flag.
      if (item.hasEOL) text += '\n';
      continue;
    }
    spans.push({ from: text.length, to: text.length + item.str.length, item });
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return { text, spans, viewport };
}

/**
 * Rectangle for characters [from, to) of one item, in storage space.
 *
 * Uses the item's own transform basis vectors rather than assuming text
 * runs left-to-right, so rotated or skewed text still gets a rect that sits
 * on the glyphs (matching how textRuns.js measures runs).
 */
function rectForRange(item, viewport, from, to) {
  const [a, b, c, d, tx, ty] = item.transform;
  const fontHeight = Math.hypot(c, d) || Math.hypot(a, b) || 10;
  const total = item.width || fontHeight * item.str.length * 0.5;
  const hLen = Math.hypot(a, b) || 1;
  const vLen = Math.hypot(c, d) || fontHeight;
  const hx = a / hLen;
  const hy = b / hLen;
  const vx = c / vLen || 0;
  const vy = d / vLen || 1;

  // Uniform advance per character is an approximation, but the alternative
  // needs the embedded font's metrics; it's accurate enough to put a
  // highlight on the right word.
  const perChar = total / (item.str.length || 1);
  const startAdv = perChar * from;
  const spanAdv = perChar * (to - from);
  const ox = tx + hx * startAdv;
  const oy = ty + hy * startAdv;

  const corners = [
    [ox, oy],
    [ox + hx * spanAdv, oy + hy * spanAdv],
    [ox + vx * fontHeight, oy + vy * fontHeight],
    [ox + hx * spanAdv + vx * fontHeight, oy + hy * spanAdv + vy * fontHeight]
  ].map(([px, py]) => viewport.convertToViewportPoint(px, py));

  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

export async function searchDocument(pdfjsDoc, query) {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) return [];
  const matches = [];

  for (let pageNum = 1; pageNum <= pdfjsDoc.numPages; pageNum++) {
    const page = await pdfjsDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const { text, spans } = buildPageIndex(textContent, viewport);
    const haystack = text.toLowerCase();

    let fromIndex = 0;
    let idx;
    while ((idx = haystack.indexOf(needle, fromIndex)) !== -1) {
      const end = idx + needle.length;
      // One rect per item the match overlaps, so a hit split across a line
      // break highlights both halves rather than a box spanning the gap.
      const rects = [];
      for (const span of spans) {
        if (span.to <= idx || span.from >= end) continue;
        const localFrom = Math.max(0, idx - span.from);
        const localTo = Math.min(span.item.str.length, end - span.from);
        if (localTo > localFrom) rects.push(rectForRange(span.item, viewport, localFrom, localTo));
      }
      if (rects.length > 0) {
        matches.push({
          pageNumber: pageNum,
          rect: rects[0],
          rects,
          // Enough surrounding text to recognise the hit in the results list.
          snippet: text.slice(Math.max(0, idx - 30), Math.min(text.length, end + 30)).replace(/\s+/g, ' ').trim()
        });
      }
      // Advance past this match so overlapping starts aren't reported twice.
      fromIndex = end;
    }
  }
  return matches;
}
