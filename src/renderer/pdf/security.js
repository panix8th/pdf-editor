import forge from 'node-forge';
import {
  PDFDocument,
  PDFHexString,
  PDFString,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFNumber
} from 'pdf-lib';

/**
 * PDF Standard Security Handler (RC4, 128-bit, Revision 3 / V2) - password
 * protection that every mainstream PDF reader (Acrobat, Chrome, pdf.js,
 * Preview, ...) can open, implemented from PDF 32000-1:2008 Algorithms
 * 3.1 - 3.6. pdf-lib has no built-in encryption support, so this walks its
 * low-level object graph directly and RC4-encrypts every string/stream.
 *
 * Scope: this covers "protect a PDF with a password" and "remove a
 * password this app (or any RC4 40/128-bit protected PDF) set" - the most
 * common real-world case. AES-encrypted (V4/V5) source files can still be
 * VIEWED (pdf.js handles those natively) but are not supported for
 * removing/changing protection - callers get a clear error instead of a
 * corrupted file.
 */

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

const KEY_LEN_BYTES = 16; // 128-bit
const REVISION = 3;

// --- low level byte / hash helpers ------------------------------------

function u8ToBinStr(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}
function binStrToU8(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}
function md5(u8) {
  const md = forge.md.md5.create();
  md.update(u8ToBinStr(u8));
  return binStrToU8(md.digest().getBytes());
}
function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
function int32LE(n) {
  const u = n >>> 0;
  return new Uint8Array([u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff]);
}
function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const tmp = S[i];
    S[i] = S[j];
    S[j] = tmp;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const tmp = S[i];
    S[i] = S[j];
    S[j] = tmp;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}
function bytesToHex(u8) {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function textToBytes(str) {
  // Passwords are expected to be ASCII/Latin-1 (per the classic Standard
  // Security Handler, which pre-dates PDFDocEncoding niceties). UTF-8
  // encode then keep only the low byte of each code unit, which is a
  // correct no-op for ASCII passwords - the overwhelming common case.
  const utf8 = unescape(encodeURIComponent(str || ''));
  const out = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i) & 0xff;
  return out;
}
function padPassword(pw) {
  const pwBytes = textToBytes(pw);
  const out = new Uint8Array(32);
  const n = Math.min(pwBytes.length, 32);
  out.set(pwBytes.slice(0, n));
  out.set(PAD.slice(0, 32 - n), n);
  return out;
}

// --- Algorithms 3.1 - 3.7 -----------------------------------------------

function computeFileKey(paddedUserPassword, oBytes, pInt, idBytes) {
  let hash = md5(concatBytes(paddedUserPassword, oBytes, int32LE(pInt), idBytes));
  for (let i = 0; i < 50; i++) hash = md5(hash.slice(0, KEY_LEN_BYTES));
  return hash.slice(0, KEY_LEN_BYTES);
}

function computeO(ownerPassword, userPassword) {
  const ownerPadded = padPassword(ownerPassword || userPassword || '');
  let hash = md5(ownerPadded);
  for (let i = 0; i < 50; i++) hash = md5(hash.slice(0, KEY_LEN_BYTES));
  const rc4Key = hash.slice(0, KEY_LEN_BYTES);
  let result = rc4(rc4Key, padPassword(userPassword || ''));
  for (let i = 1; i <= 19; i++) {
    const roundKey = rc4Key.map((b) => b ^ i);
    result = rc4(roundKey, result);
  }
  return result;
}

function recoverPaddedUserPasswordFromOwner(ownerPasswordAttempt, storedO) {
  const ownerPadded = padPassword(ownerPasswordAttempt || '');
  let hash = md5(ownerPadded);
  for (let i = 0; i < 50; i++) hash = md5(hash.slice(0, KEY_LEN_BYTES));
  const rc4Key = hash.slice(0, KEY_LEN_BYTES);
  let result = storedO.slice();
  for (let i = 19; i >= 1; i--) {
    const roundKey = rc4Key.map((b) => b ^ i);
    result = rc4(roundKey, result);
  }
  return rc4(rc4Key, result);
}

function computeU(fileKey, idBytes) {
  let hash = md5(concatBytes(PAD, idBytes));
  let result = rc4(fileKey, hash);
  for (let i = 1; i <= 19; i++) {
    const roundKey = fileKey.map((b) => b ^ i);
    result = rc4(roundKey, result);
  }
  const out = new Uint8Array(32);
  out.set(result, 0);
  return out;
}

function objectKey(fileKey, objectNumber, generationNumber) {
  const extra = new Uint8Array([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    generationNumber & 0xff,
    (generationNumber >> 8) & 0xff
  ]);
  const hash = md5(concatBytes(fileKey, extra));
  return hash.slice(0, Math.min(fileKey.length + 5, 16));
}

// --- object graph walking ------------------------------------------------

function transformLeaf(value, cipherFn) {
  if (value instanceof PDFHexString || value instanceof PDFString) {
    const bytes = value.asBytes();
    return PDFHexString.of(bytesToHex(cipherFn(bytes)));
  }
  return null;
}

function walkAndTransform(node, cipherFn, seen) {
  if (node instanceof PDFDict) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of node.keys()) {
      const val = node.get(key);
      const leaf = transformLeaf(val, cipherFn);
      if (leaf) node.set(key, leaf);
      else walkAndTransform(val, cipherFn, seen);
    }
  } else if (node instanceof PDFArray) {
    if (seen.has(node)) return;
    seen.add(node);
    for (let i = 0; i < node.size(); i++) {
      const val = node.get(i);
      const leaf = transformLeaf(val, cipherFn);
      if (leaf) node.set(i, leaf);
      else walkAndTransform(val, cipherFn, seen);
    }
  }
}

/** Apply `cipherFn` (encrypt or decrypt - RC4 is symmetric) to every string
 * and stream belonging to every indirect object, using a fresh per-object
 * key derived from `fileKey`. Skips the /Encrypt dictionary itself. */
function transformDocumentBytes(pdfDoc, fileKey, encryptDictRef) {
  const context = pdfDoc.context;
  const seen = new Set();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ref === encryptDictRef) continue;
    const key = objectKey(fileKey, ref.objectNumber, ref.generationNumber);
    const cipherFn = (bytes) => rc4(key, bytes);

    if (object instanceof PDFRawStream) {
      object.contents = cipherFn(object.contents);
      walkAndTransform(object.dict, cipherFn, seen);
    } else if (object.constructor && object.constructor.name !== 'PDFRawStream' && 'getContents' in object) {
      // Any other stream flavor (flate/content streams still pending
      // serialization): pull its final encoded bytes, then swap the
      // indirect object for a PDFRawStream holding the encrypted bytes.
      const finalBytes = object.getContents();
      const raw = PDFRawStream.of(object.dict, cipherFn(finalBytes));
      context.assign(ref, raw);
      walkAndTransform(raw.dict, cipherFn, seen);
    } else {
      walkAndTransform(object, cipherFn, seen);
    }
  }
}

function computeP({ allowPrinting = true, allowModifying = true, allowCopying = true, allowAnnotations = true } = {}) {
  let p = 0xfffff0c0;
  if (allowPrinting) p |= 0b000000000100;
  if (allowModifying) p |= 0b000000001000;
  if (allowCopying) p |= 0b000000010000;
  if (allowAnnotations) p |= 0b000000100000;
  p |= 0b100000000000; // high-res printing, mirrors "allow printing"
  return p | 0;
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Encrypt an already-built pdf-lib PDFDocument in place (call right before
 * `.save({ useObjectStreams: false })`).
 */
export function applyPasswordProtection(pdfDoc, { userPassword, ownerPassword, permissions }) {
  const context = pdfDoc.context;
  const idBytes = randomBytes(16);
  const existingId = context.trailerInfo.ID;
  const firstId =
    existingId instanceof PDFArray && existingId.size() > 0 && existingId.get(0) instanceof PDFHexString
      ? existingId.get(0).asBytes()
      : idBytes;

  const pInt = computeP(permissions);
  const oBytes = computeO(ownerPassword, userPassword);
  const paddedUser = padPassword(userPassword || '');
  const fileKey = computeFileKey(paddedUser, oBytes, pInt, firstId);
  const uBytes = computeU(fileKey, firstId);

  const encryptDict = context.obj({
    Filter: 'Standard',
    V: 2,
    R: REVISION,
    Length: KEY_LEN_BYTES * 8,
    O: PDFHexString.of(bytesToHex(oBytes)),
    U: PDFHexString.of(bytesToHex(uBytes)),
    P: PDFNumber.of(pInt)
  });
  const encryptRef = context.register(encryptDict);

  transformDocumentBytes(pdfDoc, fileKey, encryptRef);

  context.trailerInfo.Encrypt = encryptRef;
  context.trailerInfo.ID = context.obj([PDFHexString.of(bytesToHex(firstId)), PDFHexString.of(bytesToHex(idBytes))]);
}

export class UnsupportedEncryptionError extends Error {}
export class WrongPasswordError extends Error {}

/** Cheap structural check: does this PDF have an /Encrypt dictionary at
 * all? Some PDFs are "protected" with a blank user password - pdf.js opens
 * them without ever prompting, but their bytes are still encrypted at the
 * object level, so pdf-lib still needs them decrypted before editing. */
export async function isStructurallyEncrypted(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return !!pdfDoc.context.trailerInfo.Encrypt;
  } catch {
    return false;
  }
}

/**
 * Decrypt a password-protected PDF's raw bytes given a user OR owner
 * password, returning plain (unencrypted) PDF bytes suitable for further
 * editing with pdf-lib.
 */
export async function removePasswordProtection(bytes, password) {
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const context = pdfDoc.context;
  const encryptRef = context.trailerInfo.Encrypt;
  if (!encryptRef) return bytes; // wasn't encrypted to begin with

  const encryptDict = context.lookup(encryptRef, PDFDict);
  const filter = encryptDict.get(PDFName.of('Filter'));
  if (!filter || filter.asString() !== '/Standard') {
    throw new UnsupportedEncryptionError('Unsupported security handler.');
  }
  const V = encryptDict.get(PDFName.of('V'))?.asNumber?.() ?? 1;
  if (V >= 4) {
    throw new UnsupportedEncryptionError(
      'This PDF uses AES encryption, which is not yet supported for editing/removal. It can still be viewed with its password.'
    );
  }
  const R = encryptDict.get(PDFName.of('R'))?.asNumber?.() ?? 2;
  const lengthBits = encryptDict.get(PDFName.of('Length'))?.asNumber?.() ?? 40;
  const keyLen = Math.max(5, Math.floor(lengthBits / 8));
  const O = encryptDict.get(PDFName.of('O')).asBytes();
  const U = encryptDict.get(PDFName.of('U')).asBytes();
  const P = encryptDict.get(PDFName.of('P')).asNumber();
  const idArray = context.trailerInfo.ID;
  const idBytes = idArray && idArray.size() > 0 ? idArray.get(0).asBytes() : new Uint8Array(0);

  const tryKeyLen = R === 2 ? 5 : keyLen;

  function deriveWithPaddedUser(paddedUser) {
    let hash = md5(concatBytes(paddedUser, O, int32LE(P), idBytes));
    if (R >= 3) {
      for (let i = 0; i < 50; i++) hash = md5(hash.slice(0, tryKeyLen));
    }
    const fileKey = hash.slice(0, tryKeyLen);
    if (R === 2) {
      const check = rc4(fileKey, concatBytes(PAD, idBytes));
      return { fileKey, matches: bytesEqual(check, U.slice(0, 16)) };
    }
    let result = rc4(fileKey, md5(concatBytes(PAD, idBytes)));
    for (let i = 1; i <= 19; i++) {
      const roundKey = fileKey.map((b) => b ^ i);
      result = rc4(roundKey, result);
    }
    return { fileKey, matches: bytesEqual(result, U.slice(0, 16)) };
  }

  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  let attempt = deriveWithPaddedUser(padPassword(password));
  if (!attempt.matches) {
    const recoveredPaddedUser = recoverPaddedUserPasswordFromOwner(password, O);
    attempt = deriveWithPaddedUser(recoveredPaddedUser);
  }
  if (!attempt.matches) {
    throw new WrongPasswordError('Incorrect password.');
  }

  transformDocumentBytes(pdfDoc, attempt.fileKey, encryptRef);
  context.trailerInfo.Encrypt = undefined;
  return pdfDoc.save({ useObjectStreams: false });
}
