'use strict';

/**
 * Fetches a real font file from Google Fonts for the "auto-match the
 * original font" feature on click-to-edit-text. This is the one place
 * this otherwise fully offline app makes a network request - deliberately
 * confined to the main process (never exposed to the renderer's fetch/XHR,
 * which stays blocked by `connect-src 'none'`) and only ever triggered by
 * an explicit user edit action, never automatically on open/idle.
 */
const https = require('https');

// Google's CSS endpoint sniffs User-Agent to decide which font format to
// serve. Old-IE UAs get EOT (a wrapped format fontkit can't read); this old
// Android Gingerbread browser UA reliably gets plain .ttf links instead,
// which we can embed directly via fontkit with no WOFF2/EOT decoding.
const LEGACY_UA =
  'Mozilla/5.0 (Linux; U; Android 2.3.6; en-us; Nexus S Build/GRK39F) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1';
const TIMEOUT_MS = 6000;

function httpsGet(url, headers, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: TIMEOUT_MS }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpsGet(res.headers.location, headers, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

/**
 * @param {string} family Google Fonts family name, e.g. "Roboto"
 * @param {{bold?: boolean, italic?: boolean}} opts
 * @returns {Promise<Uint8Array>} raw TrueType font bytes
 */
async function fetchGoogleFont(family, opts = {}) {
  const weight = opts.bold ? '700' : '400';
  const style = opts.italic ? `${weight}italic` : weight;
  const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${style}`;
  const cssBuffer = await httpsGet(cssUrl, { 'User-Agent': LEGACY_UA });
  const css = cssBuffer.toString('utf8');
  // Google serves this either as a descriptive .../roboto/v30/xxxx.ttf path
  // or (newer) an opaque .../l/font?kit=... URL - either way, requesting it
  // with the same legacy User-Agent returns raw TrueType bytes.
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) {
    throw new Error(`"${family}" is not available on Google Fonts`);
  }
  const fontBytes = await httpsGet(match[1], { 'User-Agent': LEGACY_UA });
  const magic = fontBytes.slice(0, 4).toString('latin1');
  const isTrueType = fontBytes.length > 4 && (magic === 'true' || magic === 'OTTO' || fontBytes.readUInt32BE(0) === 0x00010000);
  if (!isTrueType) {
    throw new Error(`Unexpected font format for "${family}"`);
  }
  return new Uint8Array(fontBytes);
}

module.exports = { fetchGoogleFont };
