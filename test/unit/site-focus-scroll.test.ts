import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const DIST = join(__dirname, '..', '..', 'manager', 'dist');

// The site header is sticky and the page scrolls smoothly: a plain focus() on the theme menu (or any control in
// the header) makes the browser "bring it into view" and the page slides up by hundreds of pixels. Every focus()
// in the public site scripts must pass { preventScroll: true }.
const SCRIPTS = ['assets/theme.js', 'assets/landing.js', 'assets/site-header.js', 'docs/docs.js', 'status/status.js'];

describe('public site: moving focus never scrolls the page', () => {
  for (const file of SCRIPTS) {
    test(file, () => {
      const source = readFileSync(join(DIST, file), 'utf8');
      const calls = source.match(/\.focus\([^)]*\)/g) || [];
      const bad = calls.filter((call) => !/preventScroll:\s*true/.test(call));
      assert.deepEqual(bad, [], `${file}: focus() without { preventScroll: true }`);
    });
  }
});
