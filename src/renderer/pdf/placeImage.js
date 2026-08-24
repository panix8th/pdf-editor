import { v4 as uuid } from 'uuid';

/**
 * Opens the native "choose an image" dialog and adds the picked image as an
 * annotation.
 *
 * This deliberately goes through the app's own IPC dialog
 * (`window.pdfEditor.openFileDialog` -> `dialog.showOpenDialog`, parented
 * to the main window) rather than a renderer-created `<input type="file">`.
 * A detached input element - one never appended to the document - can have
 * its dialog open but its `change` event never delivered in a packaged
 * Electron build, so the picked file was silently dropped and no image ever
 * appeared. The IPC dialog is also modal to the window, so it can't open
 * behind it.
 */

/**
 * Determines the real image format from its magic bytes rather than the
 * file's extension/name. A file's extension can lie - renamed files,
 * screenshots saved with the wrong suffix, images downloaded from chat
 * apps - and Chromium's own `<img>` tag doesn't care, sniffing the actual
 * bytes instead. pdf-lib's embedder does the opposite: it trusts whatever
 * MIME the data URL claims and parses strictly to that format, so an
 * extension that lied produced a live preview that looked fine right up
 * until Save, which failed with a bare "undefined" (pdf-lib's PNG decoder
 * throws on non-PNG bytes with no meaningful `.message`). Sniffing here
 * makes the data URL's declared MIME match its real content, so both the
 * preview and the save path agree from the start.
 */
function sniffImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function bytesToDataUrl(bytes, mime) {
  let binary = '';
  const chunk = 0x8000; // chunked so a big image can't blow the call stack
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Loads a data URL to read its intrinsic pixel size (for aspect ratio). */
function measure(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = dataUrl;
  });
}

/**
 * @param x,y  Top-left placement point in storage space. When null, the
 *             caller wants the image centered on the page, and passes the
 *             page size via `pageSize` instead.
 */
export async function placeImageFromDialog(docId, pageKey, x, y, addAnnotation, setTool, showToast, pageSize) {
  let file;
  try {
    file = await window.pdfEditor.openFileDialog({
      title: 'Insert image',
      extensions: ['png', 'jpg', 'jpeg']
    });
  } catch {
    showToast('error', 'Could not open the image picker.');
    return;
  }
  if (!file) return; // user cancelled

  const bytes = new Uint8Array(file.data);
  const mime = sniffImageMime(bytes);
  if (!mime) {
    showToast('error', 'That file is not a valid PNG or JPG (its content did not match either format).');
    return;
  }

  const dataUrl = bytesToDataUrl(bytes, mime);
  let dims;
  try {
    dims = await measure(dataUrl);
  } catch (err) {
    showToast('error', err.message);
    return;
  }

  // Default to a readable size that still fits comfortably on the page.
  const maxW = pageSize ? pageSize.width * 0.5 : 240;
  const w = Math.min(240, maxW);
  const h = w * (dims.height / dims.width);

  const px = x != null ? x : (pageSize.width - w) / 2;
  const py = y != null ? y : (pageSize.height - h) / 2;

  const id = uuid();
  addAnnotation(docId, pageKey, {
    id,
    type: 'image',
    x: px,
    y: py,
    w,
    h,
    src: dataUrl,
    format: mime === 'image/png' ? 'png' : 'jpg'
  });
  setTool(docId, 'select');
  return id;
}
