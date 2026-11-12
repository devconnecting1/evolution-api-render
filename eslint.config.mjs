import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importX from 'eslint-plugin-import-x';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

const tsFiles = ['src/**/*.ts', 'test/**/*.ts'];

const tsRecommendedRules = tsPlugin.configs['flat/recommended'].reduce(
  (rules, config) => ({ ...rules, ...config.rules }),
  {},
);

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'manager/**', 'prisma/**'],
  },
  js.configs.recommended,
  prettierRecommended,
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['tsconfig.json', 'test/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        warnOnUnsupportedTypeScriptVersion: false,
        EXPERIMENTAL_useSourceOfProjectReferenceRedirect: true,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
      'import-x': importX,
    },
    rules: {
      ...tsRecommendedRules,
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      // O projeto compila com lib ES2020, que nao tem ErrorOptions; anexar `cause` exigiria
      // Object.assign em 23 rethrows ou subir a lib para ES2022 fora do escopo desta migracao.
      'preserve-caught-error': 'off',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
];
