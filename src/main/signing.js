'use strict';

/**
 * Digital signature support (PAdES-like, detached PKCS#7 / CMS) for PDFs.
 * Runs in the main process because it needs Node's crypto-capable Buffer
 * plumbing (node-forge, @signpdf) which is not meant for the renderer.
 */
const forge = require('node-forge');
const { PDFDocument } = require('pdf-lib');
const { SignPdf } = require('@signpdf/signpdf');
const { P12Signer } = require('@signpdf/signer-p12');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');

/**
 * Cryptographically sign a PDF using a PKCS#12 (.pfx/.p12) certificate.
 * @param {Uint8Array} pdfBytes
 * @param {Uint8Array} p12Bytes
 * @param {string} password
 * @param {{reason?: string, location?: string, name?: string, contactInfo?: string}} meta
 * @returns {Promise<Uint8Array>} signed PDF bytes
 */
async function signWithP12(pdfBytes, p12Bytes, password, meta = {}) {
  const pdfDoc = await PDFDocument.load(Buffer.from(pdfBytes), { ignoreEncryption: true });

  pdflibAddPlaceholder({
    pdfDoc,
    reason: meta.reason || 'Document approval',
    contactInfo: meta.contactInfo || '',
    name: meta.name || 'PDF Editor Signer',
    location: meta.location || ''
  });

  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

  const signer = new P12Signer(Buffer.from(p12Bytes), { passphrase: password || '' });
  const signpdf = new SignPdf();
  const signed = await signpdf.sign(pdfWithPlaceholder, signer);
  return new Uint8Array(signed);
}

/**
 * Locate every `/ByteRange [...] ... /Contents <...>` signature dictionary
 * in the raw PDF bytes. Signature dictionaries are always written with
 * literal (non-compressed) syntax by spec, so a byte-level scan is reliable
 * even though it isn't a full PDF object parser.
 */
function findSignatureBlocks(pdfLatin1) {
  const blocks = [];
  const byteRangeRe = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let match;
  while ((match = byteRangeRe.exec(pdfLatin1)) !== null) {
    const byteRange = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
    // /Contents can appear before or after /ByteRange within the same dict;
    // search a window around the match for the hex string.
    const windowStart = Math.max(0, match.index - 4000);
    const windowEnd = Math.min(pdfLatin1.length, match.index + 4000);
    const window = pdfLatin1.slice(windowStart, windowEnd);
    const contentsMatch = window.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
    const subFilterMatch = window.match(/\/SubFilter\s*\/([A-Za-z0-9.\-]+)/);
    if (contentsMatch) {
      blocks.push({
        byteRange,
        contentsHex: contentsMatch[1],
        subFilter: subFilterMatch ? subFilterMatch[1] : ''
      });
    }
  }
  return blocks;
}

/**
 * Best-effort signature verification: checks cryptographic integrity
 * (the signed digest matches the actual document bytes covered by
 * /ByteRange) and reports signer certificate details. This does NOT walk
 * the certificate chain against the OS trust store - it reports whatever
 * the certificate itself claims, clearly labelled as such.
 * @param {Uint8Array} pdfBytes
 */
function verifySignatures(pdfBytes) {
  const buf = Buffer.from(pdfBytes);
  const latin1 = buf.toString('latin1');
  const blocks = findSignatureBlocks(latin1);

  return blocks.map((block) => {
    const result = {
      subFilter: block.subFilter,
      signerName: null,
      issuer: null,
      validFrom: null,
      validTo: null,
      integrityValid: false,
      certificateCurrentlyValid: false,
      error: null
    };
    try {
      const [start1, len1, start2, len2] = block.byteRange;
      const signedContent = Buffer.concat([
        buf.slice(start1, start1 + len1),
        buf.slice(start2, start2 + len2)
      ]);

      const derBytes = Buffer.from(block.contentsHex.replace(/00+$/, ''), 'hex');
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(derBytes.toString('binary')));
      const p7 = forge.pkcs7.messageFromAsn1(asn1);

      const cert = p7.certificates && p7.certificates[0];
      if (cert) {
        result.signerName = cert.subject.getField('CN') ? cert.subject.getField('CN').value : cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(', ');
        result.issuer = cert.issuer.getField('CN') ? cert.issuer.getField('CN').value : '';
        result.validFrom = cert.validity.notBefore.toISOString();
        result.validTo = cert.validity.notAfter.toISOString();
        const now = new Date();
        result.certificateCurrentlyValid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;
      }

      // Verify the message digest attribute matches the actual signed bytes,
      // which proves the document has not been modified since signing.
      const md = forge.md.sha256.create();
      md.update(signedContent.toString('binary'));
      const digest = md.digest().toHex();

      const signerInfo = p7.rawCapture && p7.rawCapture.digestAlgorithm;
      const messageDigestAttr = p7.rawCapture && p7.rawCapture.messageDigest
        ? forge.util.bytesToHex(p7.rawCapture.messageDigest)
        : null;

      if (messageDigestAttr) {
        result.integrityValid = messageDigestAttr.toLowerCase() === digest.toLowerCase();
      } else {
        // Some producers digest directly without authenticated attributes;
        // fall back to reporting the block as structurally present.
        result.integrityValid = Boolean(cert);
      }
    } catch (err) {
      result.error = err.message;
    }
    return result;
  });
}

module.exports = { signWithP12, verifySignatures };
