import { cpSync } from 'node:fs';

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src'],
  outDir: 'dist',
  splitting: false,
  // Sem sourcemaps: o Node só os usa com --enable-source-maps (não usamos) e eles levavam o build a passar
  // de 8 GB no Render (OOM em 11/11/2026). Só CJS: a produção roda `node dist/main` (main.js).
  sourcemap: false,
  clean: true,
  minify: true,
  format: ['cjs'],
  onSuccess: async () => {
    cpSync('src/utils/translations', 'dist/translations', { recursive: true });
  },
  loader: {
    '.json': 'file',
    '.yml': 'file',
  },
});
