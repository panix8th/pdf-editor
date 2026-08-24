/**
 * Minimal re-implementation of pdf.js's PageViewport transform math, used
 * only for pages that have no real pdf.js page backing them (freshly
 * inserted blank pages). Mirrors pdf.js's own algorithm exactly so the
 * same screen<->storage coordinate helpers in coords.js work unmodified
 * for these pages too.
 */
function applyTransform([x, y], m) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function applyInverseTransform([x, y], m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  const e = -(a * m[4] + c * m[5]);
  const f = -(b * m[4] + d * m[5]);
  return [a * x + c * y + e, b * x + d * y + f];
}

function buildTransform(width, height, scale, rotation) {
  const norm = ((rotation % 360) + 360) % 360;
  let rotateA, rotateB, rotateC, rotateD;
  switch (norm) {
    case 180:
      rotateA = -1; rotateB = 0; rotateC = 0; rotateD = 1;
      break;
    case 90:
      rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0;
      break;
    case 270:
      rotateA = 0; rotateB = -1; rotateC = -1; rotateD = 0;
      break;
    default:
      rotateA = 1; rotateB = 0; rotateC = 0; rotateD = -1;
  }
  const x0 = 0, y0 = 0, x1 = width, y1 = height;
  let offsetCanvasX, offsetCanvasY, outW, outH;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(y1 - y0) * scale;
    offsetCanvasY = Math.abs(x1 - x0) * scale;
    outW = Math.abs(y1 - y0) * scale;
    outH = Math.abs(x1 - x0) * scale;
  } else {
    offsetCanvasX = Math.abs(x1 - x0) * scale;
    offsetCanvasY = Math.abs(y1 - y0) * scale;
    outW = Math.abs(x1 - x0) * scale;
    outH = Math.abs(y1 - y0) * scale;
  }
  const transform = [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetCanvasX - rotateA * scale * x0 - rotateC * scale * y0,
    offsetCanvasY - rotateB * scale * x0 - rotateD * scale * y0
  ];
  return { transform, width: outW, height: outH };
}

/** A pdf.js-PageViewport-compatible object for a page with no pdf.js proxy. */
export function fakeViewport(width, height, scale, rotation) {
  const { transform, width: w, height: h } = buildTransform(width, height, scale, rotation);
  return {
    width: w,
    height: h,
    scale,
    rotation,
    transform,
    convertToViewportPoint(x, y) {
      return applyTransform([x, y], transform);
    },
    convertToPdfPoint(x, y) {
      return applyInverseTransform([x, y], transform);
    }
  };
}

/** A pdf.js-PDFPageProxy-compatible stand-in exposing just getViewport(). */
export function fakePage(width, height) {
  return {
    isFake: true,
    getViewport({ scale, rotation }) {
      return fakeViewport(width, height, scale, rotation);
    }
  };
}
