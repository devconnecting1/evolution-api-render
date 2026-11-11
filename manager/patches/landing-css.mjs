#!/usr/bin/env node
/**
 * Public site (/ and /seguranca): the five stylesheets in one minified file, so the browser waits for one request
 * instead of five before the first paint (Lighthouse "render-blocking requests" on mobile).
 *
 * Sources stay the files people edit: assets/geist.css, landing.css, landing-theme.css, landing-plus.css and
 * security.css. This script writes assets/landing.bundle.css (minified with esbuild) and points the <link> of each
 * page at it with ?v=<content hash>, so a changed source can never be served from an old cache.
 *
 * Usage (from the repository root):
 *   node manager/patches/landing-css.mjs           # rebuild the bundle and update the pages
 *   node manager/patches/landing-css.mjs --check   # exit 1 if the bundle or a page is out of date (CI, unit test)
 * After editing any of the sources, run it without --check and commit the result.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SOURCES = ['geist.css', 'landing.css', 'landing-theme.css', 'landing-plus.css', 'security.css'];
const PAGES = ['landing/index.html', 'landing/seguranca.html'];
const BUNDLE = 'assets/landing.bundle.css';
const LINK_RE = /<link rel="stylesheet" href="\/assets\/landing\.bundle\.css\?v=[0-9a-f]+" \/>/;
const SOURCE_LINK_RE = /^[ \t]*<link rel="stylesheet" href="\/assets\/(?:geist|landing|landing-theme|landing-plus|security)\.css\?v=\d+" \/>\n/gm;

export function build() {
  const joined = SOURCES.map((name) => `/* ${name} */\n` + readFileSync(join(ROOT, 'assets', name), 'utf8')).join('\n');
  const css = transformSync(joined, { loader: 'css', minify: true, legalComments: 'none' }).code;
  const version = createHash('sha256').update(css).digest('hex').slice(0, 10);
  return { css, link: `<link rel="stylesheet" href="/assets/landing.bundle.css?v=${version}" />` };
}

function page(html, link, name) {
  if (LINK_RE.test(html)) return html.replace(LINK_RE, link);
  const first = html.search(SOURCE_LINK_RE);
  if (first < 0) throw new Error(`${name}: no landing stylesheet link found`);
  const indent = html.slice(first).match(/^[ \t]*/)[0];
  // keep the theme marker comment (manager/patches/theme.py --check looks for it)
  const out = html.replace(SOURCE_LINK_RE, '');
  return out.slice(0, first) + indent + link + '\n' + out.slice(first);
}

function main() {
  const check = process.argv.includes('--check');
  const { css, link } = build();
  const stale = [];
  let current = '';
  try {
    current = readFileSync(join(ROOT, BUNDLE), 'utf8');
  } catch {
    current = '';
  }
  if (current !== css) stale.push(BUNDLE);
  const pages = PAGES.map((name) => {
    const html = readFileSync(join(ROOT, name), 'utf8');
    const next = page(html, link, name);
    if (next !== html) stale.push(name);
    return [name, next];
  });
  if (check) {
    console.log(stale.length ? `out of date: ${stale.join(', ')} (run node manager/patches/landing-css.mjs)` : 'ok: landing bundle up to date');
    process.exit(stale.length ? 1 : 0);
  }
  writeFileSync(join(ROOT, BUNDLE), css);
  for (const [name, html] of pages) writeFileSync(join(ROOT, name), html);
  console.log(`${BUNDLE}: ${css.length} bytes; ${link}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
