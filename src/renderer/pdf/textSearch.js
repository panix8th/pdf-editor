/**
 * Full-text search across every page of a pdf.js document. Returns matches
 * with page number + the text item's bounding rect in storage space
 * (unrotated, scale 1, top-left origin) so the viewer can draw a highlight.
 */
export async function searchDocument(pdfjsDoc, query) {
  if (!query || !query.trim()) return [];
  const needle = query.trim().toLowerCase();
  const matches = [];

  for (let pageNum = 1; pageNum <= pdfjsDoc.numPages; pageNum++) {
    const page = await pdfjsDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });

    for (const item of textContent.items) {
      const str = item.str;
      if (!str) continue;
      const lower = str.toLowerCase();
      let fromIndex = 0;
      let idx;
      while ((idx = lower.indexOf(needle, fromIndex)) !== -1) {
        // item.transform = [scaleX, skewX, skewY, scaleY, x, y] in PDF space (bottom-left origin)
        const [scaleX, , , scaleY, tx, ty] = item.transform;
        const charWidth = item.width / (str.length || 1);
        const matchX = tx + idx * charWidth;
        const matchWidth = needle.length * charWidth;
        const [vx, vy] = viewport.convertToViewportPoint(matchX, ty + Math.abs(scaleY));
        const [vx2, vy2] = viewport.convertToViewportPoint(matchX + matchWidth, ty);
        matches.push({
          pageNumber: pageNum,
          rect: {
            x: Math.min(vx, vx2),
            y: Math.min(vy, vy2),
            w: Math.abs(vx2 - vx),
            h: Math.abs(vy2 - vy)
          },
          snippet: str
        });
        fromIndex = idx + 1;
      }
    }
  }
  return matches;
}
