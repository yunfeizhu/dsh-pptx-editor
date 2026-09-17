import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import nodeImport from 'eslint-plugin-node-import';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.cache/**',
      '.pnpm-store/**',
      '.dsh-dev/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    ...eslint.configs.recommended,
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { 'node-import': nodeImport },
    rules: { 'node-import/prefer-node-protocol': 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: [
      '**/*.{spec,test}.{js,mjs,ts,tsx}',
      '**/test/**/*.{js,mjs,ts,tsx}',
      '**/tests/**/*.{js,mjs,ts,tsx}',
    ],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
    },
  },
  {
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
]);
