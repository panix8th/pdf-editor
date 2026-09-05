/**
 * Character-level text selection over the runs pdf.js reports for a page,
 * so text can be selected and copied like in any PDF viewer - and so an
 * "edit this text" action knows exactly which runs it covers.
 *
 * All geometry is in storage space (top-left origin, unrotated, scale 1),
 * the same space annotations are stored in.
 */

let measureCtx = null;
function ctx() {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  return measureCtx;
}

const offsetCache = new WeakMap();

/**
 * X offsets (relative to the run's left edge) of every character boundary,
 * so there are `str.length + 1` of them.
 *
 * The widths come from measuring in a *similar* font rather than the PDF's
 * embedded one, which would be wrong on its own - so the result is scaled
 * to end exactly at the run's real advance width, which the PDF does tell
 * us. Proportions are approximate, total width is exact; that's accurate
 * enough to put a selection edge between the right two characters.
 */
export function charOffsets(run) {
  const cached = offsetCache.get(run);
  if (cached) return cached;

  const str = run.str || '';
  const offsets = [0];
  if (str.length === 0) {
    offsetCache.set(run, offsets);
    return offsets;
  }

  const c = ctx();
  c.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${run.fontSize}px ${run.fontFamilyHint || 'sans-serif'}`;
  let acc = 0;
  for (const ch of str) {
    acc += c.measureText(ch).width;
    offsets.push(acc);
  }
  const scale = acc > 0 ? run.rect.w / acc : 0;
  const scaled = offsets.map((v) => v * scale);
  offsetCache.set(run, scaled);
  return scaled;
}

/** Character boundary nearest to an x position within a run. */
function charIndexAt(run, x) {
  const offsets = charOffsets(run);
  const local = x - run.rect.x;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < offsets.length; i++) {
    const d = Math.abs(offsets[i] - local);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** The run directly under a point, or null - used to decide whether a
 * press landed on text at all (and so whether to show a text cursor). */
export function runAtPoint(runs, x, y) {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i].rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/**
 * Position to select at for an arbitrary point, snapping to the nearest
 * line when the pointer is past the end of one (or in the margin), the way
 * dragging a selection in any text view behaves.
 */
export function textPositionAt(runs, x, y) {
  if (runs.length === 0) return null;

  const exact = runAtPoint(runs, x, y);
  if (exact >= 0) return { runIdx: exact, charIdx: charIndexAt(runs[exact], x) };

  // Otherwise pick the run whose vertical band is closest, breaking ties
  // by horizontal distance so a drag into the margin extends to the end of
  // the line rather than jumping to another column.
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i].rect;
    const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
    const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
    const score = dy * 1000 + dx; // vertical proximity dominates
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  return { runIdx: best, charIdx: charIndexAt(runs[best], x) };
}

export function comparePositions(a, b) {
  if (a.runIdx !== b.runIdx) return a.runIdx - b.runIdx;
  return a.charIdx - b.charIdx;
}

/** Anchor/focus in click order -> start/end in document order. */
export function normalizeSelection(selection) {
  if (!selection) return null;
  const { anchor, focus } = selection;
  if (!anchor || !focus) return null;
  return comparePositions(anchor, focus) <= 0 ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

export function isEmptySelection(selection) {
  const norm = normalizeSelection(selection);
  return !norm || comparePositions(norm.start, norm.end) === 0;
}

/** Runs sit on different lines when their vertical positions differ by
 * more than a fraction of the line height - the same heuristic used when
 * merging runs into one editable box. */
function onDifferentLines(prev, run) {
  return Math.abs(run.rect.y - prev.rect.y) > (prev.rect.h || run.rect.h) * 0.6;
}

export function selectedText(runs, selection) {
  const norm = normalizeSelection(selection);
  if (!norm) return '';
  let out = '';
  for (let i = norm.start.runIdx; i <= norm.end.runIdx; i++) {
    const run = runs[i];
    if (!run) continue;
    const from = i === norm.start.runIdx ? norm.start.charIdx : 0;
    const to = i === norm.end.runIdx ? norm.end.charIdx : run.str.length;
    if (i > norm.start.runIdx) out += onDifferentLines(runs[i - 1], run) ? '\n' : ' ';
    out += run.str.slice(from, to);
  }
  return out;
}

/** One highlight rectangle per (partially) selected run. */
export function selectionRects(runs, selection) {
  const norm = normalizeSelection(selection);
  if (!norm) return [];
  const rects = [];
  for (let i = norm.start.runIdx; i <= norm.end.runIdx; i++) {
    const run = runs[i];
    if (!run) continue;
    const offsets = charOffsets(run);
    const last = offsets.length - 1;
    const from = Math.min(i === norm.start.runIdx ? norm.start.charIdx : 0, last);
    const to = Math.min(i === norm.end.runIdx ? norm.end.charIdx : run.str.length, last);
    if (to <= from) continue;
    const x = run.rect.x + offsets[from];
    rects.push({ x, y: run.rect.y, w: Math.max(1, run.rect.x + offsets[to] - x), h: run.rect.h });
  }
  return rects;
}

/**
 * The runs a selection touches. Editing replaces whole runs (the save path
 * hides whole content-stream operators), so a selection covering part of a
 * run still yields that entire run.
 */
export function selectedRuns(runs, selection) {
  const norm = normalizeSelection(selection);
  if (!norm) return [];
  const out = [];
  for (let i = norm.start.runIdx; i <= norm.end.runIdx; i++) {
    const run = runs[i];
    if (!run) continue;
    // A selection ending exactly at the start of a run doesn't include it.
    if (i === norm.end.runIdx && i !== norm.start.runIdx && norm.end.charIdx === 0) continue;
    out.push(run);
  }
  return out;
}

/**
 * The span of runs making up the visual line a run belongs to, for
 * triple-click selection. Runs are in stream order, which follows reading
 * order closely enough that walking outwards while the vertical position
 * holds steady recovers the line.
 */
export function lineRangeAt(runs, runIdx) {
  const pivot = runs[runIdx];
  if (!pivot) return { from: runIdx, to: runIdx };
  let from = runIdx;
  let to = runIdx;
  while (from > 0 && !onDifferentLines(runs[from - 1], pivot)) from--;
  while (to < runs.length - 1 && !onDifferentLines(pivot, runs[to + 1])) to++;
  return { from, to };
}

/** Word boundaries around a character index, for double-click selection. */
export function wordRangeAt(run, charIdx) {
  const str = run.str || '';
  if (!str) return { from: 0, to: 0 };
  const isWord = (ch) => /[^\s]/.test(ch);
  let from = Math.min(charIdx, str.length - 1);
  let to = from;
  if (!isWord(str[from])) return { from: charIdx, to: charIdx };
  while (from > 0 && isWord(str[from - 1])) from--;
  while (to < str.length && isWord(str[to])) to++;
  return { from, to };
}
