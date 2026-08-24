import { normalize } from './googleFontMap';

/**
 * Finds and loads an exact match for a PDF's font name among the fonts
 * actually installed on this PC (via Chromium's Local Font Access API),
 * so click-to-edit-text can use the real original font - offline, no
 * substitute, no network round trip - whenever it happens to already be
 * installed (which covers most Office-authored PDFs: Calibri, Cambria,
 * Segoe UI, and Arial/Times New Roman/Courier New are all standard
 * Windows fonts). This is tried before Google Fonts for exactly that
 * reason: an exact local match beats any substitute.
 */

let fontListPromise = null;

function queryOnce() {
  if (!fontListPromise) {
    fontListPromise =
      typeof window.queryLocalFonts === 'function'
        ? window.queryLocalFonts().catch(() => [])
        : Promise.resolve([]);
  }
  return fontListPromise;
}

/**
 * @returns {Promise<{family: string, bytes: Uint8Array} | null>}
 */
export async function findAndLoadSystemFont(realFontName, fontFamilyHint, { bold, italic } = {}) {
  // PDF-embedded fonts almost always carry PostScript-style names with no
  // spaces ("DejaVuSans", "TimesNewRomanPSMT"), while the OS reports
  // human-readable family names WITH spaces ("DejaVu Sans", "Times New
  // Roman"). Comparing with whitespace stripped sidesteps having to guess
  // where those spaces belong (naive camelCase-splitting would wrongly
  // break apart names like "DejaVu" itself).
  const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
  const target = squash(normalize(realFontName || fontFamilyHint));
  if (!target) return null;

  const fonts = await queryOnce();
  if (!fonts.length) return null;

  const sameFamily = fonts.filter((f) => squash(f.family) === target);
  if (sameFamily.length === 0) return null;

  // Prefer the requested weight/style, then Regular, then whatever's first.
  const wantsBoldItalic = bold && italic;
  const wantsBold = bold && !italic;
  const wantsItalic = italic && !bold;
  const pick =
    (wantsBoldItalic && sameFamily.find((f) => /bold/i.test(f.style) && /italic/i.test(f.style))) ||
    (wantsBold && sameFamily.find((f) => /bold/i.test(f.style) && !/italic/i.test(f.style))) ||
    (wantsItalic && sameFamily.find((f) => /italic/i.test(f.style) && !/bold/i.test(f.style))) ||
    sameFamily.find((f) => /^regular$/i.test(f.style)) ||
    sameFamily[0];

  try {
    const blob = await pick.blob();
    const buffer = await blob.arrayBuffer();
    return { family: pick.family, bytes: new Uint8Array(buffer) };
  } catch {
    return null;
  }
}
