/**
 * Standalone sanity check for src/renderer/pdf/security.js's hand-rolled
 * RC4 Standard Security Handler: encrypts a PDF, then decrypts it two
 * independent ways (pdf.js opening it with a password, and our own
 * removePasswordProtection stripping it entirely) to make sure real PDF
 * readers can actually open what we produce.
 *
 * Run with: node scripts/verify-encryption.mjs
 */
import { PDFDocument } from 'pdf-lib';
import { applyPasswordProtection, removePasswordProtection, WrongPasswordError } from '../src/renderer/pdf/security.js';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const SECRET_TEXT = 'Hello Secret World 12345';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

async function extractText(bytes, password) {
  const doc = await pdfjsLib.getDocument({ data: bytes, password }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => i.str).join(' ');
}

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText(SECRET_TEXT, { x: 20, y: 250, size: 18 });

  applyPasswordProtection(doc, {
    userPassword: 'user123',
    ownerPassword: 'owner456',
    permissions: { allowPrinting: true, allowCopying: false }
  });
  const encrypted = await doc.save({ useObjectStreams: false });
  console.log('Encrypted PDF size:', encrypted.length);

  // 1. pdf.js should require a password
  let requiredPassword = false;
  try {
    await extractText(encrypted, undefined);
  } catch (err) {
    requiredPassword = err.name === 'PasswordException';
  }
  assert(requiredPassword, 'pdf.js reports the file needs a password');

  // 2. pdf.js should reject a wrong password
  let rejectedWrong = false;
  try {
    await extractText(encrypted, 'nope');
  } catch (err) {
    rejectedWrong = err.name === 'PasswordException';
  }
  assert(rejectedWrong, 'pdf.js rejects an incorrect password');

  // 3. pdf.js should open with the correct USER password and read the text back
  const textViaUser = await extractText(encrypted, 'user123');
  assert(textViaUser.includes(SECRET_TEXT), 'pdf.js decrypts with the user password and text matches');

  // 4. pdf.js should also open with the OWNER password
  const textViaOwner = await extractText(encrypted, 'owner456');
  assert(textViaOwner.includes(SECRET_TEXT), 'pdf.js decrypts with the owner password and text matches');

  // 5. removePasswordProtection with the wrong password should throw
  let threw = false;
  try {
    await removePasswordProtection(encrypted, 'nope');
  } catch (err) {
    threw = err instanceof WrongPasswordError;
  }
  assert(threw, 'removePasswordProtection rejects a wrong password');

  // 6. removePasswordProtection with the correct password yields a plain,
  //    unencrypted PDF that pdf-lib and pdf.js can both open with no password.
  const decrypted = await removePasswordProtection(encrypted, 'user123');
  const reloaded = await PDFDocument.load(decrypted);
  assert(reloaded.getPageCount() === 1, 'pdf-lib re-loads the decrypted PDF');
  const textAfterRemoval = await extractText(decrypted, undefined);
  assert(textAfterRemoval.includes(SECRET_TEXT), 'text survives password removal, no password needed to open');

  console.log('\nAll encryption/decryption checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
