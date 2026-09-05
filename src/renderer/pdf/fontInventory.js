import { PDFDocument, PDFDict, PDFName, PDFArray } from 'pdf-lib';

/**
 * What fonts a PDF actually uses, and whether this machine can render them
 * faithfully.
 *
 * Three states matter, and they are not the same thing:
 *  - **embedded**: the font's glyphs travel inside the file. It looks
 *    identical everywhere and nothing needs installing.
 *  - **standard**: one of the 14 base fonts every PDF reader is required to
 *    provide. Also fine, also nothing to install.
 *  - **missing**: referenced by name but neither embedded nor installed
 *    here, so this machine is substituting something else and the document
 *    is not being shown as its author intended.
 *
 * That last case is the one worth surfacing - it is invisible otherwise,
 * and it is exactly when editing text will not match the surrounding page.
 */

// The 14 base fonts, by the /BaseFont names PDFs actually use.
const STANDARD_14 = new Set(
  [
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Symbol', 'ZapfDingbats',
    // Common aliases producers emit for the same faces.
    'Arial', 'Arial-Bold', 'Arial,Bold', 'ArialMT', 'Arial-BoldMT',
    'TimesNewRoman', 'TimesNewRomanPSMT', 'CourierNew', 'CourierNewPSMT'
  ].map((n) => n.toLowerCase())
);

/** Subset fonts carry a six-letter tag: "ABCDEF+Calibri-Bold". */
function stripSubsetTag(name) {
  return /^[A-Z]{6}\+/.test(name) ? name.slice(7) : name;
}

/** Splits "Calibri-BoldItalic" / "Arial,BoldItalic" into family + style
 * flags, which is how a PDF names a face and how it has to be matched
 * against an installed family. */
export function parseBaseFont(rawName) {
  const name = stripSubsetTag(rawName || '');
  const [familyPart, ...rest] = name.split(/[-,]/);
  const styleText = rest.join(' ');
  return {
    name,
    family: familyPart || name,
    bold: /bold|black|heavy|semibold|demi/i.test(styleText),
    italic: /italic|oblique/i.test(styleText),
    // PostScript names have no spaces; the OS reports families with them.
    // Comparing squashed sidesteps guessing where the spaces belong.
    key: (familyPart || name).replace(/\s+/g, '').toLowerCase()
  };
}

function descriptorOf(fontDict) {
  const direct = fontDict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  if (direct) return direct;
  // Composite (Type0) fonts keep the descriptor one level down.
  const descendants = fontDict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  if (!descendants || descendants.size() === 0) return null;
  const first = descendants.lookup(0, PDFDict);
  return first ? first.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict) : null;
}

function isEmbedded(descriptor) {
  if (!descriptor) return false;
  return ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.get(PDFName.of(k)) !== undefined);
}

/** Walks a resource dictionary's /Font entries, recursing through Form
 * XObjects - text is regularly drawn from inside those, and a font used
 * only there would otherwise be missed entirely. */
function collectFromResources(resources, found, seen, depth = 0) {
  if (!resources || depth > 8) return;

  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (fonts) {
    for (const [, ref] of fonts.entries()) {
      let fontDict;
      try {
        fontDict = resources.context.lookup(ref, PDFDict);
      } catch {
        continue;
      }
      if (!fontDict) continue;
      const baseFont = fontDict.get(PDFName.of('BaseFont'));
      if (!baseFont) continue;
      const raw = baseFont.decodeText ? baseFont.decodeText() : String(baseFont).replace(/^\//, '');
      const parsed = parseBaseFont(raw);
      const existing = found.get(parsed.name);
      const embedded = isEmbedded(descriptorOf(fontDict));
      if (existing) {
        existing.embedded = existing.embedded || embedded;
      } else {
        found.set(parsed.name, { ...parsed, embedded, standard: STANDARD_14.has(parsed.name.toLowerCase()) });
      }
    }
  }

  const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return;
  for (const [, ref] of xobjects.entries()) {
    const key = String(ref);
    if (seen.has(key)) continue; // XObjects can reference each other
    seen.add(key);
    try {
      const xo = resources.context.lookup(ref);
      const dict = xo && xo.dict ? xo.dict : xo;
      if (dict instanceof PDFDict) {
        collectFromResources(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), found, seen, depth + 1);
      }
    } catch {
      /* an unreadable XObject just contributes no fonts */
    }
  }
}

/**
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<Array<{name, family, bold, italic, key, embedded, standard}>>}
 */
export async function inventoryDocumentFonts(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const found = new Map();
  const seen = new Set();
  for (const page of doc.getPages()) {
    collectFromResources(page.node.Resources(), found, seen);
  }
  return [...found.values()].sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
}

/**
 * Pairs each font the document uses with the installed family that can
 * supply it, so the UI can say "fine" or "substituted" per font.
 *
 * @param inventory from inventoryDocumentFonts
 * @param installedFaces from the system font index (main process)
 */
export function classifyFonts(inventory, installedFaces) {
  const byKey = new Map();
  for (const face of installedFaces) {
    const key = face.family.replace(/\s+/g, '').toLowerCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(face);
  }

  return inventory.map((font) => {
    const installed = byKey.get(font.key) || [];
    let status;
    if (font.embedded) status = 'embedded';
    else if (font.standard) status = 'standard';
    else if (installed.length > 0) status = 'installed';
    else status = 'missing';
    return { ...font, status, installedFaces: installed };
  });
}

/** Picks the face of an installed family that best matches a requested
 * weight/style, the same way a text renderer would. */
export function pickFace(faces, { bold, italic } = {}) {
  if (!faces || faces.length === 0) return null;
  const wantWeight = bold ? 700 : 400;
  let best = null;
  let bestScore = Infinity;
  for (const face of faces) {
    // Style match dominates: a Bold Italic is a far worse stand-in for
    // Regular than a Medium is, however close the weights.
    const score = Math.abs((face.weight || 400) - wantWeight) + (!!face.italic === !!italic ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = face;
    }
  }
  return best;
}
