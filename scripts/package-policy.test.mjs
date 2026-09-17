import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { validatePackage } from './package-policy.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const patch = load(readFileSync('cordis.patch.yml', 'utf8'));
const files = [
  'package.json',
  'cordis.patch.yml',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/client.js',
  'dist/client.d.ts',
  'dist/editor/editor.html',
  'dist/editor/editor.js',
  'dist/editor/editor.css',
  'dist/THIRD_PARTY_LICENSES.txt',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
].map((path) => ({ path, size: 100 }));

describe('published package boundary', () => {
  it('accepts a prebuilt Web bundle', () => {
    expect(validatePackage(pkg, patch, files)).toEqual([]);
  });
  it('rejects an inactive bundle or a source-relative loader', () => {
    expect(validatePackage({ ...pkg, dsh: {} }, patch, files)).not.toEqual([]);
    expect(
      validatePackage(
        pkg,
        [{ insert: [{ id: 'pptx-editor', name: './dist/index.js' }] }],
        files,
      ),
    ).not.toEqual([]);
  });
  it('rejects missing assets and broken exported paths', () => {
    expect(
      validatePackage(
        pkg,
        patch,
        files.filter((file) => file.path !== 'dist/editor/editor.css'),
      ),
    ).not.toEqual([]);
    expect(
      validatePackage({ ...pkg, main: './src/index.ts' }, patch, files),
    ).not.toEqual([]);
  });
  it.each([
    '.env',
    '.cache/profile/auth.json',
    'tests/private.pptx',
    'dist/editor.js.map',
    'dist/../secret.js',
  ])('rejects unintended file %s', (path) => {
    expect(
      validatePackage(pkg, patch, [...files, { path, size: 100 }]),
    ).not.toEqual([]);
  });
  it('rejects a private/prerelease package or install-time build', () => {
    expect(
      validatePackage(
        { ...pkg, private: true, version: '0.1.0-beta.1' },
        patch,
        files,
      ),
    ).toHaveLength(2);
    expect(
      validatePackage(
        { ...pkg, scripts: { prepare: 'pnpm build' } },
        patch,
        files,
      ),
    ).not.toEqual([]);
  });
});
