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

// Already on Google Fonts - use as-is when the PDF names one of these.
const KNOWN_GOOGLE_FONTS = new Set([
  'roboto', 'open sans', 'lato', 'montserrat', 'poppins', 'source sans pro',
  'nunito', 'raleway', 'ubuntu', 'merriweather', 'playfair display', 'oswald',
  'pt sans', 'noto sans', 'inter', 'work sans', 'rubik', 'mulish', 'karla',
  'ibm plex sans', 'dm sans', 'quicksand', 'josefin sans', 'fira sans',
  'arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'gelasio'
]);

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

/** Returns a Google Fonts family name to try fetching, or null if this
 * font isn't a good candidate (caller falls back to the built-in guess). */
export function resolveGoogleFontCandidate(realFontName, fontFamilyHint) {
  const candidates = [normalize(realFontName), normalize(fontFamilyHint)].filter(Boolean);
  for (const raw of candidates) {
    const key = raw.toLowerCase();
    if (KNOWN_GOOGLE_FONTS.has(key)) return raw;
    if (METRIC_COMPATIBLE[key]) return METRIC_COMPATIBLE[key];
  }
  return null;
}
