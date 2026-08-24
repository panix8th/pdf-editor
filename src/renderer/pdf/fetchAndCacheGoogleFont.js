import { getCachedResolvedFontId, cacheResolvedFontId } from '../state/docResources';

/**
 * Tries each candidate Google Fonts family name in order (via the main
 * process - see src/main/googleFonts.js) and keeps the first one that
 * actually exists there, registering it as a custom font for this
 * document. Used by both automatic font-matching (click-to-edit-text) and
 * the manual "Google Fonts..." picker, so caching/registration logic only
 * lives in one place.
 *
 * @returns {Promise<{fontFamily: string, fontId: string} | null>}
 */
export async function resolveAndCacheGoogleFont(docId, candidates, { bold, italic, registerCustomFont }) {
  for (const family of candidates) {
    if (!family) continue;
    const cacheKey = `gf:${family}:${bold}:${italic}`;
    const cachedFontId = getCachedResolvedFontId(docId, cacheKey);
    if (cachedFontId) return { fontFamily: family, fontId: cachedFontId };
    try {
      const result = await window.pdfEditor.fetchGoogleFont(family, bold, italic);
      if (result.ok) {
        const fontId = `gfont-${family}-${Date.now()}`;
        registerCustomFont(docId, fontId, result.data, family);
        cacheResolvedFontId(docId, cacheKey, fontId);
        return { fontFamily: family, fontId };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
