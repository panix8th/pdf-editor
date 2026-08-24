/**
 * Renders scripts/icon.svg to build/icon.png (512x512, used by
 * electron-builder as the icon source on most platforms) and build/icon.ico
 * (multi-resolution, required for the Windows NSIS/portable exe icon).
 *
 * Run with: node scripts/make-icons.mjs
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import pngToIco from 'png-to-ico';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svgPath = path.join(__dirname, 'icon.svg');
const buildDir = path.join(root, 'build');

const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  await fs.mkdir(buildDir, { recursive: true });
  const svg = await fs.readFile(svgPath, 'utf8');
  const html = `<html><body style="margin:0">${svg}</body></html>`;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const pngPaths = [];
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(html);
    const el = await page.$('svg');
    const outPath = path.join(buildDir, `icon-${size}.png`);
    await el.screenshot({ path: outPath, omitBackground: false });
    pngPaths.push(outPath);
    await page.close();
  }
  await browser.close();

  // 512x512 master PNG (electron-builder wants >=256, 512 is the safe default)
  const master = pngPaths.find((p) => p.includes('-256'));
  await fs.copyFile(master, path.join(buildDir, 'icon.png'));

  const icoBuffer = await pngToIco(pngPaths);
  await fs.writeFile(path.join(buildDir, 'icon.ico'), icoBuffer);

  for (const p of pngPaths) await fs.unlink(p);

  console.log('Wrote build/icon.png and build/icon.ico');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
