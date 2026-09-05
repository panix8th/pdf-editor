import { normalize } from './googleFontMap';
import { pickFace } from './fontInventory';

/**
 * The fonts installed on this machine, and matching a PDF's font name
 * against them.
 *
 * The list comes from the main process reading the OS font directories
 * directly (see src/main/systemFonts.js). It used to come from Chromium's
 * Local Font Access API, which needed a permission grant, only worked from
 * a user gesture, and on plenty of systems returned nothing - so "use the
 * font that's already installed" silently never happened. Reading the
 * directories has none of those limits: every installed font, every time.
 */

let indexPromise = null;

/** @returns {Promise<Array>} every installed face; empty if unavailable. */
export function loadSystemFontIndex({ force = false } = {}) {
  if (force) indexPromise = null;
  if (!indexPromise) {
    indexPromise = (window.pdfEditor?.fonts?.listSystem({ force }) ?? Promise.resolve({ ok: false }))
      .then((r) => (r && r.ok ? r.faces : []))
      .catch(() => []);
  }
  return indexPromise;
}

/** Families rather than faces, for pickers: one entry per family with all
 * of its faces, sorted for display. */
export async function loadSystemFontFamilies(opts) {
  const faces = await loadSystemFontIndex(opts);
  const byFamily = new Map();
  for (const face of faces) {
    if (!byFamily.has(face.family)) byFamily.set(face.family, { family: face.family, faces: [] });
    byFamily.get(face.family).faces.push(face);
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** Loads one installed face's bytes, ready to embed. */
export async function loadFaceBytes(face) {
  const result = await window.pdfEditor.fonts.loadFace(face.path, face.postscriptName);
  if (!result || !result.ok) throw new Error(result?.error || 'That font could not be read.');
  return { family: result.family || face.family, bytes: new Uint8Array(result.data) };
}

// PDF-embedded fonts almost always carry PostScript-style names with no
// spaces ("DejaVuSans", "TimesNewRomanPSMT"), while the OS reports
// human-readable families WITH spaces ("DejaVu Sans", "Times New Roman").
// Comparing with whitespace stripped sidesteps having to guess where those
// spaces belong - naive camelCase splitting would wrongly break apart
// names like "DejaVu" itself.
const squash = (s) => (s || '').replace(/\s+/g, '').toLowerCase();

/**
 * An exact match for a PDF's font name among the installed fonts, loaded
 * and ready to embed - the real original glyphs, offline, no substitute.
 * Tried before Google Fonts for exactly that reason.
 *
 * @returns {Promise<{family: string, bytes: Uint8Array} | null>}
 */
export async function findAndLoadSystemFont(realFontName, fontFamilyHint, { bold, italic } = {}) {
  const target = squash(normalize(realFontName || fontFamilyHint));
  if (!target) return null;

  const faces = await loadSystemFontIndex();
  const sameFamily = faces.filter((f) => squash(f.family) === target);
  if (sameFamily.length === 0) return null;

  const pick = pickFace(sameFamily, { bold, italic });
  if (!pick) return null;
  try {
    return await loadFaceBytes(pick);
  } catch {
    return null;
  }
}
