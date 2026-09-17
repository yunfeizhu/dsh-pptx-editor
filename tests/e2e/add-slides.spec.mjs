import { downloadPptx, reopenPptx } from './viewer-files.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

test('conversation adds slides and text with undo, ordered export and reopen', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const fixture = [...(await readFile('.cache/synthetic.pptx'))];
  // Only the OS picker and disk boundary are adapted; the viewer and plugin tools are real.
  await page.addInitScript((initial) => {
    let disk = new Uint8Array(initial);
    window.__slideWrites = 0;
    window.showOpenFilePicker = async () => [
      {
        name: 'synthetic.pptx',
        getFile: async () => new File([disk], 'synthetic.pptx'),
        createWritable: async () => {
          let staged;
          return {
            write: async (bytes) => {
              staged = new Uint8Array(bytes);
            },
            close: async () => {
              disk = staged;
              window.__savedSlides = [...disk];
              window.__slideWrites += 1;
            },
            abort: async () => {},
          };
        },
      },
    ];
  }, fixture);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test/panel?session=slide-insertion');
  const editor = page.frameLocator('iframe');
  await editor
    .getByRole('button', { name: '打开 PPTX', exact: true })
    .first()
    .click();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeEnabled({ timeout: 30_000 });
  const send = (name, args = {}) =>
    request.post('/test/command', {
      data: { name, args, sessionId: 'slide-insertion' },
    });
  const call = async (name, args = {}) => {
    const response = await send(name, args);
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  };
  const read = () => call('read_pptx');
  const base = (state) => ({
    documentId: state.documentId,
    version: state.version,
  });
  const undo = () =>
    editor
      .getByRole('button', { name: /^撤[销消]/ })
      .first()
      .click();
  const redo = () =>
    editor.getByRole('button', { name: /^重做/ }).first().click();
  const original = await read();
  expect(original.slides).toHaveLength(2);
  const insertion = { ...base(original), summary: 'Append a third slide' };
  const added = await call('add_pptx_slide', insertion);
  expect(added).toMatchObject({
    slideIndex: 2,
    slideCount: 3,
    status: 'applied',
  });
  let state = await read();
  expect(state.activeSlideIndex).toBe(2);
  expect(state.slides.slice(0, 2)).toEqual(original.slides);
  const replay = await send('add_pptx_slide', insertion);
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error).toContain('Stale');
  await undo();
  expect((await read()).slides).toEqual(original.slides);
  await redo();
  state = await read();
  expect(state.slides).toHaveLength(3);
  expect(state.activeSlideIndex).toBe(2);
  const title = await call('add_pptx_text', {
    ...base(state),
    slideIndex: 2,
    summary: 'Add a title',
    text: '新增计划 / New plan',
    x: 64,
    y: 48,
    width: 800,
    height: 80,
    fontSize: 36,
    bold: true,
    color: '#123456',
  });
  await expect(
    editor.getByText('新增计划 / New plan', { exact: true }).last(),
  ).toBeVisible();
  const bodyInput = {
    ...base(await read()),
    slideIndex: 2,
    summary: 'Add body text',
    text: '第一阶段：明确目标\nSecond phase: <build> & verify',
    x: 64,
    y: 160,
    width: 900,
    height: 220,
  };
  const body = await call('add_pptx_text', bodyInput);
  expect(body.elementId).not.toBe(title.elementId);
  expect((await read()).slides[2].elements).toHaveLength(2);
  await undo();
  expect(
    (await read()).slides[2].elements.map((element) => element.id),
  ).toEqual([title.elementId]);
  await redo();
  state = await read();
  expect(state.slides[2].elements).toHaveLength(2);
  await call('edit_pptx', {
    ...base(state),
    slideIndex: 2,
    elementId: title.elementId,
    summary: 'Edit inserted title',
    patch: { text: 'Updated inserted title' },
  });
  await expect(
    editor.getByText('Updated inserted title', { exact: true }).last(),
  ).toBeVisible();
  await undo();
  expect(
    (await read()).slides[2].elements.find(
      (element) => element.id === title.elementId,
    ).text,
  ).toBe('新增计划 / New plan');
  const frame = page
    .frames()
    .find((candidate) => candidate.url().includes('/dsh-pptx/'));
  expect(await frame.evaluate(() => window.__slideWrites)).toBe(0);
  await page
    .locator('iframe')
    .screenshot({ path: '.cache/add-slides-preview.png' });
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(editor.locator('.pptx-bar')).toHaveCount(0);
  await expect(
    editor.getByRole('main', { name: '幻灯片编辑器' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Inserting in the middle must preserve original slide order and relationships on export.
  await call('add_pptx_slide', {
    ...base(await read()),
    afterSlideIndex: 0,
    summary: 'Insert between original slides',
  });
  await call('add_pptx_text', {
    ...base(await read()),
    slideIndex: 1,
    summary: 'Identify inserted middle page',
    text: 'Middle slide',
    x: 64,
    y: 48,
    width: 700,
    height: 90,
  });
  state = await read();
  expect(state.slides).toHaveLength(4);
  expect(state.slides[2].elements).toEqual(original.slides[1].elements);
  const saved = await downloadPptx(page, editor);
  const archive = await JSZip.loadAsync(new Uint8Array(saved));
  const parser = new XMLParser({ ignoreAttributes: false });
  const presentation = parser.parse(
    await archive.file('ppt/presentation.xml').async('string'),
  );
  const relationships = parser.parse(
    await archive.file('ppt/_rels/presentation.xml.rels').async('string'),
  ).Relationships.Relationship;
  const ids = presentation['p:presentation']['p:sldIdLst']['p:sldId'];
  expect(ids).toHaveLength(4);
  const orderedXml = await Promise.all(
    ids.map(async (slide) => {
      const target = relationships.find(
        (rel) => rel['@_Id'] === slide['@_r:id'],
      )['@_Target'];
      const path = target.startsWith('/')
        ? target.slice(1)
        : posix.normalize(`ppt/${target}`);
      return archive.file(path).async('string');
    }),
  );
  expect(orderedXml[0]).toContain('Project Atlas');
  expect(orderedXml[1]).toContain('Middle slide');
  expect(orderedXml[2]).toContain('Quarterly plan');
  expect(orderedXml[3]).toContain('新增计划 / New plan');
  expect(orderedXml[3]).toContain('第一阶段：明确目标');
  expect(orderedXml[3]).toContain('123456');
  expect(orderedXml[3]).toContain('sz="2700"');
  expect(archive.file('ppt/charts/chart1.xml')).not.toBeNull();
  expect(
    archive.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'),
  ).not.toBeNull();
  await reopenPptx(page, editor, saved);
  const reopened = await read();
  expect(reopened.documentId).not.toBe(original.documentId);
  expect(reopened.slides).toHaveLength(4);
  expect(
    reopened.slides[1].elements.some(
      (element) => element.text === 'Middle slide',
    ),
  ).toBe(true);
  expect(
    reopened.slides[3].elements.some(
      (element) => element.text === '新增计划 / New plan',
    ),
  ).toBe(true);
  expect(
    reopened.slides[3].elements.some((element) =>
      element.text?.includes('Second phase: <build> & verify'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
