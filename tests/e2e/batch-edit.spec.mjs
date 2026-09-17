import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { downloadPptx, reopenPptx } from './viewer-files.mjs';

test('conversation batch edits two slides atomically with independent undo, rejection and native save', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const bytes = [...(await readFile('.cache/synthetic.pptx'))];
  await page.addInitScript((data) => {
    window.showOpenFilePicker = async () => [
      {
        name: 'synthetic.pptx',
        getFile: async () => new File([new Uint8Array(data)], 'synthetic.pptx'),
      },
    ];
  }, bytes);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test/panel?session=batch-edit');
  const editor = page.frameLocator('iframe');
  await editor.getByRole('button', { name: '打开 PPTX', exact: true }).click();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeEnabled();
  const send = (name, args = {}) =>
    page.request.post('/test/command', {
      data: { name, args, sessionId: 'batch-edit' },
    });
  const call = async (name, args = {}) => {
    const response = await send(name, args);
    const value = await response.json();
    expect(response.ok(), JSON.stringify(value)).toBe(true);
    return value;
  };
  const read = () => call('read_pptx');
  const base = async () => {
    const state = await read();
    return {
      documentId: state.documentId,
      version: state.version,
      summary: 'Batch regression',
    };
  };
  const original = await read();
  const first = original.slides[0].elements.find(
    (el) => el.text === 'Project Atlas',
  );
  const second = original.slides[1].elements.find(
    (el) => el.text === 'Quarterly plan',
  );
  const subtitle = original.slides[0].elements.find(
    (el) => el.text === 'Synthetic presentation',
  );
  const byId = (state, index, id) =>
    state.slides[index].elements.find((el) => el.id === id);
  await call('edit_pptx', {
    ...(await base()),
    slideIndex: 0,
    elementId: subtitle.id,
    patch: { text: 'Before batch' },
  });
  const before = await read();
  const change = {
    ...(await base()),
    edits: [
      {
        slideIndex: 0,
        elementId: first.id,
        patch: {
          text: 'Quarterly review',
          textStyle: { align: 'center', color: '#112233' },
        },
      },
      {
        slideIndex: 1,
        elementId: second.id,
        patch: {
          text: 'Next steps',
          textStyle: { align: 'center', color: '#112233' },
        },
      },
    ],
  };
  expect(await call('edit_pptx_batch', change)).toMatchObject({
    status: 'applied',
    undoSteps: 1,
  });
  const applied = await read();
  expect(applied.activeSlideIndex).toBe(before.activeSlideIndex);
  expect(applied.selectedElementIds).toEqual(before.selectedElementIds);
  expect(byId(applied, 0, first.id)).toMatchObject({
    text: 'Quarterly review',
    textStyle: { align: 'center', color: '#112233' },
  });
  expect(byId(applied, 1, second.id)).toMatchObject({
    text: 'Next steps',
    textStyle: { align: 'center', color: '#112233' },
  });
  const op = async (operation) =>
    call('operate_pptx', { action: { ...(await base()), operation } });
  await page.waitForTimeout(3000);
  await editor
    .getByRole('button', { name: 'Go to slide 2', exact: true })
    .click();
  await op('undo');
  expect((await read()).slides).toEqual(before.slides);
  await op('undo');
  expect((await read()).slides).toEqual(original.slides);
  await op('redo');
  await op('redo');
  expect((await read()).slides).toEqual(applied.slides);
  await call('edit_pptx', {
    ...(await base()),
    slideIndex: 0,
    elementId: subtitle.id,
    patch: { text: 'After batch' },
  });
  await op('undo');
  expect((await read()).slides).toEqual(applied.slides);

  const beforeFailure = await read();
  const rejected = await send('edit_pptx_batch', {
    ...(await base()),
    edits: [
      { slideIndex: 0, elementId: first.id, patch: { text: 'Must not apply' } },
      {
        slideIndex: 1,
        elementId: 'missing-element',
        patch: { text: 'Invalid' },
      },
    ],
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toContain('Element not found');
  expect((await read()).slides).toEqual(beforeFailure.slides);
  expect((await read()).version).toBe(beforeFailure.version);
  expect((await send('edit_pptx_batch', change)).status()).toBe(400);
  expect(
    await call('edit_pptx_batch', {
      ...(await base()),
      edits: [{ slideIndex: 0, elementId: first.id, patch: { x: first.x } }],
    }),
  ).toMatchObject({ status: 'unchanged', undoSteps: 0 });
  const saved = await downloadPptx(page, editor);
  const archive = await JSZip.loadAsync(saved);
  expect(await archive.file('ppt/slides/slide1.xml').async('string')).toContain(
    'Quarterly review',
  );
  expect(await archive.file('ppt/slides/slide2.xml').async('string')).toContain(
    'Next steps',
  );
  await reopenPptx(page, editor, saved, 'batch-saved.pptx');
  const reopened = await read();
  for (const [index, title] of ['Quarterly review', 'Next steps'].entries())
    expect(
      reopened.slides[index].elements.find((el) => el.text === title),
    ).toMatchObject({ textStyle: { align: 'center', color: '#112233' } });
  expect(
    reopened.slides[1].elements.filter((el) =>
      ['table', 'chart', 'picture'].includes(el.type),
    ),
  ).toHaveLength(3);
  expect(errors).toEqual([]);
});
