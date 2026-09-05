import { PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/**
 * Removes chosen text from a page's *actual* content stream, instead of
 * painting a rectangle over it.
 *
 * The old approach (still the fallback) covered an edited run with a
 * rectangle in its sampled background color and drew the replacement on
 * top. That leaves a visible patch whenever the background isn't a flat
 * color - over an image, a gradient, a table rule - which is exactly what
 * makes an edit look pasted-on.
 *
 * What happens here instead: the glyphs are switched to PDF text rendering
 * mode 3 ("invisible") by injecting `3 Tr` before the text-showing
 * operator's operands and restoring the previous mode right after. The
 * string itself is left untouched, so every advance, kern and subsequent
 * position in that text object stays bit-identical - nothing downstream
 * shifts. The replacement is then drawn onto a genuinely empty spot.
 *
 * The trade-off, stated plainly: the original characters remain in the
 * file's text layer - invisible, but still found by a text search or copy.
 * That is equally true of the cover-rectangle approach, so this is
 * strictly better, but it is not redaction. The Redact tool, which
 * rasterizes the page, remains the way to actually destroy content.
 */

// PDF whitespace per spec (plus \f, which some producers emit).
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const TEXT_SHOWING_OPS = new Set(['Tj', 'TJ', "'", '"']);

const isWhitespace = (b) => WHITESPACE.has(b);
const isDelimiter = (b) => DELIMITERS.has(b);

/**
 * Splits a content stream into its operators, recording for each one both
 * the operator keyword's byte range and where its operands begin. Values
 * are deliberately not parsed - the only thing that matters is never
 * mistaking string, array or inline-image payload for an operator.
 *
 * @returns {Array<{op: string, argStart: number, start: number, end: number}>}
 *   in stream order. `argStart` is where this operator's operands start
 *   (i.e. just past the previous operator), which is the only safe place
 *   to inject an operator of our own: putting it between the operands and
 *   their operator would leave the wrong values on the operand stack.
 */
export function tokenizeOperators(bytes) {
  const ops = [];
  let i = 0;
  let argStart = 0;
  const len = bytes.length;

  while (i < len) {
    const b = bytes[i];

    if (isWhitespace(b)) {
      i++;
      continue;
    }

    // Comment: % ... EOL
    if (b === 0x25) {
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }

    // Literal string: ( ... ) with balanced parens and backslash escapes
    if (b === 0x28) {
      i++;
      let depth = 1;
      while (i < len && depth > 0) {
        const c = bytes[i];
        if (c === 0x5c) {
          i += 2; // an escape consumes whatever byte follows
          continue;
        }
        if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        i++;
      }
      continue;
    }

    // Hex string < ... >, or the dictionary opener <<
    if (b === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2;
        continue;
      }
      i++;
      while (i < len && bytes[i] !== 0x3e) i++;
      i++;
      continue;
    }

    // Other structural delimiters: step over, their contents tokenize
    // normally on subsequent passes.
    if (b === 0x3e || b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d) {
      i += b === 0x3e && bytes[i + 1] === 0x3e ? 2 : 1;
      continue;
    }

    // Name: /Foo
    if (b === 0x2f) {
      i++;
      while (i < len && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) i++;
      continue;
    }

    // A "regular" token: either a number (operand) or an operator keyword.
    const start = i;
    while (i < len && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) i++;
    const raw = String.fromCharCode(...bytes.subarray(start, i));
    if (/^[+\-.\d]/.test(raw)) continue; // numbers are operands, not operators

    ops.push({ op: raw, argStart, start, end: i });
    argStart = i;

    // Inline images carry arbitrary binary between ID and EI, which would
    // otherwise tokenize as junk operators - and can easily contain the
    // bytes "Tj". Skip straight to the terminating EI.
    if (raw === 'ID') {
      i++; // the single whitespace byte after ID belongs to the data
      while (i < len) {
        const atEI =
          bytes[i] === 0x45 &&
          bytes[i + 1] === 0x49 &&
          (i + 2 >= len || isWhitespace(bytes[i + 2]) || isDelimiter(bytes[i + 2])) &&
          i > 0 &&
          isWhitespace(bytes[i - 1]);
        if (atEI) {
          ops.push({ op: 'EI', argStart: i, start: i, end: i + 2 });
          i += 2;
          argStart = i;
          break;
        }
        i++;
      }
    }
  }

  return ops;
}

export function countTextShowingOps(bytes) {
  return tokenizeOperators(bytes).filter((o) => TEXT_SHOWING_OPS.has(o.op)).length;
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A page's /Contents is either one stream or an array of streams that
 * concatenate into a single logical stream; decode to one flat array. */
function readPageContentBytes(page) {
  const raw = page.node.Contents();
  if (!raw) return null;
  const contents = raw instanceof PDFArray || raw instanceof PDFRawStream ? raw : page.node.context.lookup(raw);

  const streams = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (s instanceof PDFRawStream) streams.push(s);
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents);
  }
  if (streams.length === 0) return null;

  // Per spec the parts are concatenated with at least one whitespace byte,
  // and some producers split tokens across the boundary relying on it.
  const parts = [];
  streams.forEach((s, idx) => {
    if (idx > 0) parts.push(new Uint8Array([0x0a]));
    parts.push(decodePDFRawStream(s).decode());
  });
  return concatBytes(parts);
}

const encoder = new TextEncoder();

/** Reads an operator's single numeric operand out of the raw bytes between
 * the previous operator and this one (e.g. the `3` of `3 Tr`). */
function numericOperand(bytes, op) {
  const text = String.fromCharCode(...bytes.subarray(op.argStart, op.start));
  const m = /(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Hides text-showing operators - identified by their index within the
 * page's sequence of text-showing operators - by wrapping each in
 * `3 Tr` ... `<previous mode> Tr`.
 *
 * @returns {Set<number>} the indices actually hidden. Callers must check
 *   this rather than assume success: an operator drawing in a clipping
 *   text mode is deliberately left alone, so an edit spanning it still
 *   needs the cover-rectangle fallback.
 */
export function hideTextOps(page, opIndices) {
  const wanted = new Set(opIndices);
  const hidden = new Set();
  if (wanted.size === 0) return hidden;

  const bytes = readPageContentBytes(page);
  if (!bytes) return hidden;

  const ops = tokenizeOperators(bytes);

  // Text render mode is part of the graphics state, so it survives BT/ET
  // but is saved and restored by q/Q. Track both so the mode we restore is
  // the one that was actually in effect (a document legitimately using,
  // say, mode 2 must not be reset to 0).
  const edits = [];
  const stack = [];
  let renderMode = 0;
  let textOpIndex = 0;

  for (const op of ops) {
    if (op.op === 'q') {
      stack.push(renderMode);
      continue;
    }
    if (op.op === 'Q') {
      renderMode = stack.length ? stack.pop() : renderMode;
      continue;
    }
    if (op.op === 'Tr') {
      const mode = numericOperand(bytes, op);
      if (mode !== null) renderMode = mode;
      continue;
    }
    if (!TEXT_SHOWING_OPS.has(op.op)) continue;

    const index = textOpIndex++;
    if (!wanted.has(index)) continue;
    if (renderMode === 3) continue; // already invisible
    // Modes 4-7 add the glyphs to the clipping path; making those
    // invisible would silently change what the rest of the page clips to,
    // so leave them alone and let the caller fall back.
    if (renderMode >= 4) continue;

    edits.push({ argStart: op.argStart, opEnd: op.end, restoreTo: renderMode });
    hidden.add(index);
  }

  if (edits.length === 0) return hidden;

  const pieces = [];
  let cursor = 0;
  for (const edit of edits) {
    pieces.push(bytes.subarray(cursor, edit.argStart));
    // Leading space matters: argStart sits immediately after the previous
    // operator keyword, so without it `Tf` + `3` would fuse into `Tf3`.
    pieces.push(encoder.encode(' 3 Tr '));
    pieces.push(bytes.subarray(edit.argStart, edit.opEnd));
    pieces.push(encoder.encode(` ${edit.restoreTo} Tr `));
    cursor = edit.opEnd;
  }
  pieces.push(bytes.subarray(cursor));

  const context = page.node.context;
  const newStream = context.flateStream(concatBytes(pieces));
  page.node.set(PDFName.of('Contents'), context.register(newStream));
  return hidden;
}

/**
 * Whether index-based mapping between pdf.js's text runs and this page's
 * own content stream can be trusted. Text drawn from inside a Form XObject
 * appears in pdf.js's flattened operator list but not in the page stream,
 * which would make every index point at the wrong glyphs - so require the
 * two counts to agree exactly before touching anything.
 */
export function canEditTextInPlace(page, expectedTextOpCount) {
  try {
    const bytes = readPageContentBytes(page);
    if (!bytes) return false;
    return countTextShowingOps(bytes) === expectedTextOpCount;
  } catch {
    return false;
  }
}
