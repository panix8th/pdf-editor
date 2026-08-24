/**
 * Coordinate space bridge between the on-screen viewer and stored
 * annotation geometry.
 *
 * Annotations are always stored in "storage space": the page's own
 * mediabox, unrotated, at scale 1, with the ORIGIN AT THE TOP-LEFT
 * (y grows downward - the same convention as screen/CSS pixels). This
 * makes the geometry stable across zoom and page-rotation changes: only
 * the live viewport used to draw the page on screen changes, never the
 * stored numbers.
 *
 * We piggy-back on pdf.js's own PageViewport#convertToPdfPoint /
 * #convertToViewportPoint so all the rotation/scale trigonometry is
 * pdf.js's problem, not ours.
 */

export function getBaseViewport(pdfPage) {
  return pdfPage.getViewport({ scale: 1, rotation: 0 });
}

function toStoragePoint(pdfPage, x, y) {
  const base = getBaseViewport(pdfPage);
  return base.convertToViewportPoint(x, y);
}

function toPdfPoint(pdfPage, x, y) {
  const base = getBaseViewport(pdfPage);
  return base.convertToPdfPoint(x, y);
}

/** Convert a screen-space point (from the live, possibly rotated/zoomed viewport) to storage space. */
export function screenPointToStorage(pdfPage, liveViewport, sx, sy) {
  const [pdfX, pdfY] = liveViewport.convertToPdfPoint(sx, sy);
  return toStoragePoint(pdfPage, pdfX, pdfY);
}

/** Convert a storage-space point to screen space for the given live viewport. */
export function storagePointToScreen(pdfPage, liveViewport, stx, sty) {
  const [pdfX, pdfY] = toPdfPoint(pdfPage, stx, sty);
  return liveViewport.convertToViewportPoint(pdfX, pdfY);
}

/** Convert a screen-space DELTA (e.g. a mouse drag distance) to a storage-space
 * delta, correctly accounting for the live viewport's rotation - a plain
 * `/scale` division only works when rotation is 0. */
export function screenDeltaToStorage(pdfPage, liveViewport, dx, dy) {
  const origin = screenPointToStorage(pdfPage, liveViewport, 0, 0);
  const moved = screenPointToStorage(pdfPage, liveViewport, dx, dy);
  return [moved[0] - origin[0], moved[1] - origin[1]];
}

/** Convert a screen-space rect {x,y,w,h} into a normalized storage-space rect. */
export function screenRectToStorage(pdfPage, liveViewport, rect) {
  const [x1, y1] = screenPointToStorage(pdfPage, liveViewport, rect.x, rect.y);
  const [x2, y2] = screenPointToStorage(pdfPage, liveViewport, rect.x + rect.w, rect.y + rect.h);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1)
  };
}

/** Convert a storage-space rect {x,y,w,h} into a screen-space rect for the given live viewport. */
export function storageRectToScreen(pdfPage, liveViewport, rect) {
  const [x1, y1] = storagePointToScreen(pdfPage, liveViewport, rect.x, rect.y);
  const [x2, y2] = storagePointToScreen(pdfPage, liveViewport, rect.x + rect.w, rect.y + rect.h);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1)
  };
}

/** Convert a storage-space rect (top-left origin, unrotated) into pdf-lib's
 * bottom-left-origin coordinate for the ORIGINAL unrotated page height. */
export function storageRectToPdfLib(rect, pageHeight) {
  return {
    x: rect.x,
    y: pageHeight - rect.y - rect.h,
    w: rect.w,
    h: rect.h
  };
}

/** Convert an array of storage-space {x,y} points (e.g. a pen stroke) to pdf-lib space. */
export function storagePointsToPdfLib(points, pageHeight) {
  return points.map((p) => ({ x: p.x, y: pageHeight - p.y }));
}
