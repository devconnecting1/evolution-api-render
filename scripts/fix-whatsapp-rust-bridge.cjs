#!/usr/bin/env node
/**
 * postinstall: lets `tsx` load Baileys 7.0.0-rc12+ (tests and `npm start`).
 *
 * Baileys rc12+ depends on `whatsapp-rust-bridge`, whose package.json only declares the "import" condition in
 * `exports`. Plain Node (`node dist/main`, production) loads it fine through require(esm). `tsx`, however, turns the
 * Baileys ESM files into CommonJS when the project `require`s them, so the bridge is then resolved with the
 * "require" condition and fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * Adding `"default": "./dist/index.js"` next to "import" fixes that resolution and changes nothing for Node itself
 * (same file, no top-level await). Idempotent; does nothing when the package is absent or already has the entry.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'whatsapp-rust-bridge', 'package.json');
try {
  if (!fs.existsSync(file)) process.exit(0);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = pkg.exports && pkg.exports['.'];
  if (!root || typeof root !== 'object' || root.default || !root.import) process.exit(0);
  pkg.exports['.'] = { ...root, default: root.import };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log('[postinstall] whatsapp-rust-bridge: "default" export added for tsx');
} catch (error) {
  // Never break an install over this: only tsx-based runs need it.
  console.warn('[postinstall] whatsapp-rust-bridge not patched:', error && error.message);
}
