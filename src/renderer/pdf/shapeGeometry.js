/**
 * Shape geometry shared by the live preview (SVG/DOM in AnnotationLayer)
 * and the baked output (pdf-lib in documentIO).
 *
 * Both consumers derive their geometry from these functions so the two can
 * never drift apart. That drift is exactly what made arrows look "weird":
 * the preview drew an SVG `<marker>` arrowhead (auto-scaled by
 * `markerUnits="strokeWidth"`, so it ballooned as the stroke got thicker)
 * while the save path drew two thin open strokes off the tip - two
 * different shapes from the same annotation.
 *
 * All coordinates here are in storage space (top-left origin, unrotated,
 * scale 1), the same space annotations are stored in.
 */

/** Fill opacity used when a shape has a fill color but no explicit
 * `fillOpacity`. Shared so the preview and the save path agree - they used
 * to default to 0.3 and 1 respectively, so a filled rect saved far more
 * opaque than it looked on screen. */
export const DEFAULT_FILL_OPACITY = 0.3;

/**
 * Splits an arrow into the shaft line and the filled triangular head.
 *
 * The shaft deliberately stops short of the tip so it doesn't poke out
 * through the head (with a small overlap so no seam shows at the join),
 * and the head is sized from the stroke width but capped relative to the
 * arrow's own length - so a short arrow can't end up as nearly all
 * arrowhead.
 *
 * @returns {{shaft: {x1,y1,x2,y2}, head: Array<[number, number]>, headLen: number}}
 */
export function arrowGeometry(x1, y1, x2, y2, strokeWidth) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const w = strokeWidth || 2;

  if (len < 0.001) {
    return { shaft: { x1, y1, x2, y2 }, head: [], headLen: 0 };
  }

  // Proportional to stroke width (so a thick arrow gets a proportionally
  // solid head) but never more than 40% of the arrow itself.
  const headLen = Math.min(Math.max(w * 3.5, 7), len * 0.4);
  const halfWidth = headLen * 0.42;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy; // unit perpendicular
  const py = ux;

  // Base of the head, and the shaft's stopping point just inside it.
  const baseX = x2 - ux * headLen;
  const baseY = y2 - uy * headLen;
  const shaftEndX = x2 - ux * headLen * 0.85;
  const shaftEndY = y2 - uy * headLen * 0.85;

  return {
    shaft: { x1, y1, x2: shaftEndX, y2: shaftEndY },
    head: [
      [x2, y2],
      [baseX + px * halfWidth, baseY + py * halfWidth],
      [baseX - px * halfWidth, baseY - py * halfWidth]
    ],
    headLen
  };
}

/** `points` attribute for an SVG <polygon>, from arrowGeometry().head. */
export function pointsAttr(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * The stroked outline of a shape straddles its path: PDF strokes are
 * centered on the path, so a rect drawn at exactly the stored rect bleeds
 * `borderWidth / 2` outside it on every side. CSS `border` with
 * `box-sizing: border-box` (what the preview uses) instead draws the
 * border entirely *inside* the box. Insetting the PDF rect by half the
 * border width makes the two line up.
 */
export function insetForStroke(rect, strokeWidth) {
  const half = (strokeWidth || 0) / 2;
  return {
    x: rect.x + half,
    y: rect.y + half,
    w: Math.max(0, rect.w - strokeWidth),
    h: Math.max(0, rect.h - strokeWidth)
  };
}
