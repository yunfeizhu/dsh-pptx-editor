import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleLicenses } from './bundle-licenses.mjs';

describe('bundled dependency attribution', () => {
  it('collects full notices once per package and traverses export-only manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'pptx-licenses-'));
    try {
      const pkg = join(root, 'node_modules/example');
      mkdirSync(join(pkg, 'esm'), { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name: 'example', version: '1.0.0' }),
      );
      writeFileSync(join(pkg, 'esm/package.json'), '{"type":"module"}');
      writeFileSync(join(pkg, 'LICENSE'), 'Full license permission text.');
      writeFileSync(join(pkg, 'NOTICE.txt'), 'Original attribution.');
      const result = bundleLicenses(
        [
          {
            inputs: {
              'node_modules/example/esm/index.js': {},
              'node_modules/example/index.js': {},
              'src/editor.ts': {},
            },
          },
        ],
        root,
      );
      expect(result.match(/example@1\.0\.0/g)).toHaveLength(1);
      expect(result).toContain('Full license permission text.');
      expect(result).toContain('Original attribution.');
      expect(result).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('fails the build when an embedded dependency omits its license', () => {
    const root = mkdtempSync(join(tmpdir(), 'pptx-licenses-'));
    try {
      const pkg = join(root, 'node_modules/example');
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name: 'example', version: '1.0.0' }),
      );
      expect(() =>
        bundleLicenses(
          [{ inputs: { 'node_modules/example/index.js': {} } }],
          root,
        ),
      ).toThrow('Missing license');
      writeFileSync(join(pkg, 'LICENSE'), '');
      expect(() =>
        bundleLicenses(
          [{ inputs: { 'node_modules/example/index.js': {} } }],
          root,
        ),
      ).toThrow('Empty license');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('uses pinned upstream notices only for the reviewed package version', () => {
    const root = mkdtempSync(join(tmpdir(), 'pptx-licenses-'));
    try {
      const pkg = join(root, 'node_modules/example');
      mkdirSync(pkg, { recursive: true });
      const manifest = { name: '@ai-sdk/provider-utils', version: '5.0.40' };
      writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
      const inputs = [{ inputs: { 'node_modules/example/index.js': {} } }];
      const result = bundleLicenses(inputs, root);
      expect(result).toContain('Copyright 2023 Vercel, Inc.');
      expect(result).toContain('9ed46d2da5df1394079c66d422bc553fd0c34376');
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ ...manifest, version: '5.0.41' }),
      );
      expect(() => bundleLicenses(inputs, root)).toThrow('Missing license');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
