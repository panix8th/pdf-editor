/**
 * Maps a PDF's actual (embedded or standard-14) font name to a Google
 * Fonts family we can fetch and embed, so an edited run keeps looking
 * like the original font instead of falling back to bare Helvetica/Times/
 * Courier. Two cases:
 *  - The document already uses an open font that happens to be on Google
 *    Fonts (Roboto, Open Sans, Montserrat, ...) - pass the name through.
 *  - The document uses a common proprietary font (Arial, Calibri, Times
 *    New Roman, ...) - substitute its metrics-compatible Google Fonts
 *    equivalent, so line breaks/spacing stay close to the original.
 */

const METRIC_COMPATIBLE = {
  arial: 'Arimo',
  helvetica: 'Arimo',
  'arial narrow': 'Arimo',
  'times new roman': 'Tinos',
  times: 'Tinos',
  'courier new': 'Cousine',
  courier: 'Cousine',
  calibri: 'Carlito',
  cambria: 'Caladea',
  georgia: 'Gelasio',
  verdana: 'Arimo',
  tahoma: 'Arimo',
  'segoe ui': 'Roboto',
  'trebuchet ms': 'Roboto'
};

/** Strips subset tags ("ABCDEF+"), weight/style suffixes, and common
 * PostScript naming artifacts down to a bare family name for matching. */
function normalize(name) {
  return (name || '')
    .replace(/^[A-Z]{6}\+/, '') // subset prefix, e.g. "ABCDEF+Arial"
    .replace(/[-,]?\s?(MT|PS|PSMT)$/i, '')
    .replace(/[-,]?\s?(Bold|Italic|Oblique|Regular|Light|Medium|Semibold|Black)+$/gi, '')
    .replace(/[-_]/g, ' ')
    .trim();
}

/**
 * Returns an ordered list of Google Fonts family names worth trying for
 * this PDF font, most-faithful first. The caller (AnnotationLayer) tries
 * each against the real Google Fonts catalog in order and keeps the first
 * one that actually exists there - so this never needs to be an exhaustive
 * "is this really on Google Fonts" list. It just needs to put the best
 * guesses first:
 *   1. The PDF's own font name, verbatim - covers every font that's
 *      already on Google Fonts (Roboto, Open Sans, Montserrat, ... -
 *      thousands of them) without maintaining a matching list here.
 *   2. A metrics-compatible substitute for common proprietary fonts
 *      (Arial -> Arimo, Calibri -> Carlito, ...), so a document using a
 *      font Google Fonts doesn't have at all still gets something close.
 */
export function resolveGoogleFontCandidates(realFontName, fontFamilyHint) {
  const candidates = [];
  const raw = normalize(realFontName) || normalize(fontFamilyHint);
  if (raw) candidates.push(raw);
  const substitute = METRIC_COMPATIBLE[raw.toLowerCase()];
  if (substitute) candidates.push(substitute);
  return [...new Set(candidates)];
}
