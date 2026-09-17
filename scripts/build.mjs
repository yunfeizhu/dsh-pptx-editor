import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { bundleLicenses } from './bundle-licenses.mjs';

await rm('dist', { recursive: true, force: true });
const types = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.build.json',
    '--emitDeclarationOnly',
  ],
  { stdio: 'inherit' },
);
if (types.error) throw types.error;
if (types.status !== 0) process.exit(types.status ?? 1);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
const client = await build({
  entryPoints: ['src/client.tsx'],
  write: false,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime'],
  minify: true,
  metafile: true,
});
await writeFile(
  'dist/client.js',
  `window.__ModuleLoader__.load({id: 'dsh-pptx-editor', factory(require) { const module = {exports: {}}; const exports = module.exports;\n${client.outputFiles[0].text}\nreturn module.exports; }});\n`,
);
const editor = await build({
  entryPoints: ['src/editor/main.tsx'],
  outfile: 'dist/editor/editor.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  metafile: true,
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
await mkdir('dist/editor', { recursive: true });
await writeFile(
  'dist/editor/editor.html',
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PPTX editor</title><link rel="stylesheet" href="./editor.css"></head><body><div id="root"></div><script type="module" src="./editor.js"></script></body></html>',
);
console.log('Built DSH host plugin, client module and isolated editor.');
await writeFile(
  'dist/THIRD_PARTY_LICENSES.txt',
  bundleLicenses([client.metafile, editor.metafile]),
);
