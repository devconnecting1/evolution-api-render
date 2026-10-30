#!/usr/bin/env node
// Generates the web app icons of the Manager from manager/dist/assets/images/favicon.svg.
// Rendered with headless Chromium (Playwright), so the PNGs match how browsers draw the SVG.
// Usage (from the repository root, with playwright available to node):
//   node manager/patches/pwa-icons.mjs
// Output (manager/dist/assets/images/): icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const images = path.join(root, 'manager', 'dist', 'assets', 'images');
const svg = fs.readFileSync(path.join(images, 'favicon.svg'), 'utf8');
const BACKGROUND = '#f6ffff'; // --background of the light theme (hsl 178 98.4% 98.22%)

// size: output px; logo: share of the side used by the logo (maskable icons keep it inside the 80% safe zone)
const ICONS = [
  { file: 'icon-192.png', size: 192, logo: 0.78 },
  { file: 'icon-512.png', size: 512, logo: 0.78 },
  { file: 'icon-maskable-512.png', size: 512, logo: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, logo: 0.72 },
];

const browser = await pw.chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  const side = Math.round(icon.size * icon.logo);
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;
    display:flex;align-items:center;justify-content:center;background:${BACKGROUND}">
    <div style="width:${side}px;height:${side}px;display:flex;align-items:center;justify-content:center">
    ${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(images, icon.file), omitBackground: false });
  console.log(`${icon.file} ${icon.size}x${icon.size}`);
}
await browser.close();
