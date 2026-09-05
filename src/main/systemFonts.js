'use strict';

/**
 * The complete list of fonts actually installed on this machine, read
 * straight off disk.
 *
 * The renderer used to ask Chromium for this via the Local Font Access API
 * (`queryLocalFonts`), which needs a permission grant, only works from a
 * user gesture, and on plenty of systems returns nothing at all - so the
 * "System Fonts..." picker was a permission dance that often ended in an
 * empty list. The main process has no such restriction: it can read the
 * OS font directories directly, so this gives every installed font, every
 * time, with no prompt.
 *
 * Faces are read with fontkit so the names here are the font's OWN names
 * (family, style, PostScript name) rather than a filename guess - that's
 * what makes matching a PDF's `/BaseFont` against installed fonts work.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
// Scanning stops here so a symlink loop or a pathological directory can't
// hang the app; real font trees are only two or three levels deep.
const MAX_DEPTH = 6;

function fontDirectories() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const winDir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(winDir, 'Fonts'),
      // Where Windows 10+ puts fonts installed "for me only", which is the
      // default when a user double-clicks a font file and hits Install.
      path.join(localAppData, 'Microsoft', 'Windows', 'Fonts')
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      path.join(home, 'Library', 'Fonts')
    ];
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    path.join(home, '.fonts'),
    path.join(home, '.local', 'share', 'fonts')
  ];
}

async function collectFontFiles(dir, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory missing or unreadable - simply contributes nothing
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFontFiles(full, depth + 1, out);
    } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      try {
        const stat = await fs.stat(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }
}

/** Style flags from the font's own tables rather than its style name,
 * which is free text and inconsistent across foundries ("Book", "Roman",
 * "Oblique", "Heavy Italic", ...). */
function describeFace(face) {
  const os2 = face['OS/2'];
  const macStyle = face.head && face.head.macStyle;
  const weight = (os2 && os2.usWeightClass) || (macStyle && macStyle.bold ? 700 : 400);
  const italic =
    !!(os2 && os2.fsSelection && (os2.fsSelection.italic || os2.fsSelection.oblique)) ||
    !!(macStyle && macStyle.italic) ||
    (typeof face.italicAngle === 'number' && face.italicAngle !== 0);
  return {
    family: face.familyName || '',
    style: face.subfamilyName || 'Regular',
    fullName: face.fullName || '',
    postscriptName: face.postscriptName || '',
    weight,
    italic,
    monospaced: !!(face.post && face.post.isFixedPitch)
  };
}

/** Every face in one font file. A .ttc/.otc holds several. */
function readFacesFromFile(filePath) {
  const bytes = fsSync.readFileSync(filePath);
  const parsed = fontkit.create(bytes);
  const faces = Array.isArray(parsed.fonts) ? parsed.fonts : [parsed];
  const out = [];
  for (const face of faces) {
    try {
      const info = describeFace(face);
      if (!info.family || !info.postscriptName) continue;
      out.push({ ...info, path: filePath, collection: faces.length > 1 });
    } catch {
      /* one unreadable face in a collection shouldn't lose the others */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index + cache
// ---------------------------------------------------------------------------

let cacheFilePath = null;
/** Called once at startup so the cache can live in Electron's userData
 * directory without this module depending on `electron` (which keeps it
 * testable from plain Node). */
function setCacheDirectory(dir) {
  cacheFilePath = path.join(dir, 'system-font-index.json');
}

function readCache() {
  if (!cacheFilePath) return null;
  try {
    return JSON.parse(fsSync.readFileSync(cacheFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(payload) {
  if (!cacheFilePath) return;
  try {
    fsSync.writeFileSync(cacheFilePath, JSON.stringify(payload));
  } catch {
    /* a cache that can't be written just means the next scan is slow */
  }
}

/** Identifies the exact set of font files on disk, so an index built from
 * a different set is never reused. Cheap to compute (stat only) compared
 * with parsing every file. */
function signatureOf(files) {
  return files
    .map((f) => `${f.path}:${Math.round(f.mtimeMs)}:${f.size}`)
    .sort()
    .join('|');
}

let inFlight = null;

/**
 * @param {boolean} force skip the cache and re-parse every file
 * @returns {Promise<{faces: Array, fromCache: boolean, scannedFiles: number}>}
 */
async function listSystemFonts({ force = false } = {}) {
  if (inFlight && !force) return inFlight;
  const run = (async () => {
    const files = [];
    for (const dir of fontDirectories()) await collectFontFiles(dir, 0, files);

    const signature = signatureOf(files);
    if (!force) {
      const cached = readCache();
      if (cached && cached.signature === signature && Array.isArray(cached.faces)) {
        return { faces: cached.faces, fromCache: true, scannedFiles: files.length };
      }
    }

    const faces = [];
    for (const file of files) {
      try {
        faces.push(...readFacesFromFile(file.path));
      } catch {
        // Bitmap-only fonts, Type1 wrappers and the occasional corrupt file
        // land here. Skipping one file is always better than failing the
        // whole list.
      }
    }
    faces.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
    writeCache({ signature, faces });
    return { faces, fromCache: false, scannedFiles: files.length };
  })();

  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Loading a single face for embedding
// ---------------------------------------------------------------------------

const SFNT_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

/**
 * Rebuilds one face of a .ttc/.otc collection as a standalone font file.
 *
 * A collection stores one shared blob of tables and gives each face its own
 * table directory pointing into it. pdf-lib embeds whatever bytes it is
 * handed, and handing it a collection doesn't work - so the face's tables
 * are copied out into a fresh sfnt. Without this, every font Windows ships
 * as a collection (Cambria among them, which is all over Office-exported
 * PDFs) would be listed but not usable.
 */
function extractFaceFromCollection(sourceBytes, face) {
  const tables = Object.values(face.directory.tables).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const numTables = tables.length;
  const pad4 = (n) => (n + 3) & ~3;

  let total = SFNT_HEADER_SIZE + numTables * TABLE_RECORD_SIZE;
  for (const t of tables) total += pad4(t.length);

  const out = Buffer.alloc(total);
  // The collection's face directory carries the real sfnt version tag
  // ('true'/0x00010000 for TrueType outlines, 'OTTO' for CFF).
  const version = typeof face.directory.tag === 'string' ? Buffer.from(face.directory.tag, 'latin1') : null;
  if (version && version.length === 4) version.copy(out, 0);
  else out.writeUInt32BE(0x00010000, 0);

  out.writeUInt16BE(numTables, 4);
  // searchRange / entrySelector / rangeShift: a binary-search hint derived
  // from the table count, per the sfnt spec.
  const entrySelector = Math.floor(Math.log2(numTables || 1));
  const searchRange = 2 ** entrySelector * 16;
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);

  let recordPos = SFNT_HEADER_SIZE;
  let dataPos = SFNT_HEADER_SIZE + numTables * TABLE_RECORD_SIZE;
  for (const table of tables) {
    out.write(table.tag.padEnd(4, ' ').slice(0, 4), recordPos, 4, 'latin1');
    out.writeUInt32BE(table.checkSum >>> 0, recordPos + 4);
    out.writeUInt32BE(dataPos, recordPos + 8);
    out.writeUInt32BE(table.length, recordPos + 12);
    recordPos += TABLE_RECORD_SIZE;

    sourceBytes.copy(out, dataPos, table.offset, table.offset + table.length);
    dataPos += pad4(table.length); // the gap is already zero-filled
  }
  return out;
}

/**
 * Raw bytes of one installed face, ready to embed.
 * @returns {Promise<{data: Uint8Array, family: string, postscriptName: string}>}
 */
async function loadFontFace(filePath, postscriptName) {
  const bytes = fsSync.readFileSync(filePath);
  const parsed = fontkit.create(bytes);

  if (!Array.isArray(parsed.fonts)) {
    return {
      data: new Uint8Array(bytes),
      family: parsed.familyName || path.basename(filePath),
      postscriptName: parsed.postscriptName || ''
    };
  }

  const face = parsed.fonts.find((f) => f.postscriptName === postscriptName) || parsed.fonts[0];
  if (!face) throw new Error('That font file contains no usable face.');
  const extracted = extractFaceFromCollection(bytes, face);
  return { data: new Uint8Array(extracted), family: face.familyName, postscriptName: face.postscriptName };
}

module.exports = { listSystemFonts, loadFontFace, setCacheDirectory, fontDirectories };
