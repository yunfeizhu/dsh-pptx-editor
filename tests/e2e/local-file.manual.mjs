import { downloadPptx, reopenPptx } from './viewer-files.mjs';
import { test, expect } from '@playwright/test';
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import JSZip from 'jszip';

// Opt-in local verification. Input is never modified; only an ignored export is written.
test('local presentation opens, edits, exports and reopens', async ({
  page,
  request,
}) => {
  const path = process.env.PPTX_TEST_FILE;
  if (!path)
    throw new Error(
      'Set PPTX_TEST_FILE to an explicitly authorized local file',
    );
  const source = await realpath(path);
  const output = resolve('.cache/manual/roundtrip.pptx');
  if (!relative(source, output)) throw new Error('Use a distinct source file');
  const bytes = await readFile(source);
  const original = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(original.files).filter((path) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(path),
  );
  await page.addInitScript(
    (initial) => {
      let disk = new Uint8Array(initial);
      window.__savedPptx = initial;
      window.showOpenFilePicker = () =>
        Promise.resolve([
          {
            name: 'local-test.pptx',
            getFile: () => Promise.resolve(new File([disk], 'local-test.pptx')),
            createWritable: () =>
              Promise.resolve({
                write: (value) => {
                  disk = new Uint8Array(value);
                  return Promise.resolve();
                },
                close: () => {
                  window.__savedPptx = [...disk];
                  return Promise.resolve();
                },
                abort: () => Promise.resolve(),
              }),
          },
        ]);
    },
    [...bytes],
  );
  await page.goto('/test/panel');
  const editor = page.frameLocator('iframe');
  await editor
    .getByRole('button', { name: '打开 PPTX', exact: true })
    .first()
    .click();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeEnabled({
    timeout: 30_000,
  });
  const call = async (name, args = {}) => {
    const response = await request.post('/test/command', {
      data: { name, args },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const before = await call('read_pptx');
  expect(before.slides.length).toBe(slidePaths.length);
  const element = before.slides[0].elements.find(
    (entry) => entry.type === 'text',
  );
  expect(Boolean(element)).toBe(true);
  await call('edit_pptx', {
    documentId: before.documentId,
    version: before.version,
    slideIndex: 0,
    elementId: element.id,
    summary: 'Local round-trip test',
    patch: { x: element.x + 1 },
  });
  const saved = await downloadPptx(page, editor);
  await mkdir(resolve('.cache/manual'), { recursive: true });
  await writeFile(output, saved);
  const exported = await JSZip.loadAsync(saved);
  expect(
    Object.keys(exported.files).filter((path) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path),
    ),
  ).toEqual(slidePaths);
  const features = (zip, pattern) =>
    Object.keys(zip.files).filter((path) => pattern.test(path));
  for (const pattern of [
    /^ppt\/charts\/chart\d+\.xml$/,
    /^ppt\/media\/.+[^/]$/,
    /^ppt\/embeddings\/.+[^/]$/,
  ]) {
    expect(features(exported, pattern)).toEqual(features(original, pattern));
  }
  await reopenPptx(page, editor, saved, 'local-test.pptx');
  const reopened = await call('read_pptx');
  expect(reopened.documentId).not.toBe(before.documentId);
  expect(reopened.slides.length).toBe(slidePaths.length);
  expect(
    reopened.slides[0].elements.find((entry) => entry.id === element.id).x,
  ).toBeCloseTo(element.x + 1, 2);
  expect(Buffer.compare(await readFile(source), bytes)).toBe(0);
});
