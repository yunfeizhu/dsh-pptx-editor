import { downloadPptx, reopenPptx } from './viewer-files.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

test('conversation manages slides and elements through public APIs', async ({
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
  await page.goto('/test/panel?session=operations');
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
      data: { name, args, sessionId: 'operations' },
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
  const original = await read();
  const missingTarget = original.slides[0].elements[0].id;
  const wrongSlide = await send('operate_pptx', {
    action: {
      ...base(original),
      operation: 'delete-elements',
      slideIndex: 1,
      elementIds: [missingTarget],
      summary: 'Reject without consuming version',
    },
  });
  expect(wrongSlide.ok()).toBe(false);
  expect(await wrongSlide.text()).toContain('Element not found on this slide');
  expect((await read()).version).toBe(original.version);
  const op = async (input) =>
    call('operate_pptx', {
      action: {
        ...base(await read()),
        summary: 'Synthetic operation',
        ...input,
      },
    });
  await call('operate_pptx', {
    action: {
      ...base(original),
      operation: 'navigate',
      slideIndex: 1,
      summary: 'Correct the target with the still-current version',
    },
  });
  expect((await read()).activeSlideIndex).toBe(1);
  await op({ operation: 'duplicate-slide', slideIndex: 1 });
  let state = await read();
  expect(state.slides).toHaveLength(3);
  expect(state.activeSlideIndex).toBe(2);
  expect(state.slides[2].elements.map((el) => el.text)).toEqual(
    original.slides[1].elements.map((el) => el.text),
  );
  await op({ operation: 'move-slide', slideIndex: 2, toIndex: 0 });
  expect((await read()).activeSlideIndex).toBe(0);
  await op({ operation: 'set-slide-hidden', slideIndex: 0, hidden: true });
  expect((await read()).slides[0].hidden).toBe(true);
  await op({ operation: 'undo' });
  expect((await read()).slides[0].hidden).toBe(false);
  await op({ operation: 'redo' });
  expect((await read()).slides[0].hidden).toBe(true);
  await op({ operation: 'set-slide-hidden', slideIndex: 0, hidden: false });
  const copyTitle = (await read()).slides[0].elements.find(
    (el) => el.text === 'Quarterly plan',
  );
  await call('edit_pptx', {
    ...base(await read()),
    slideIndex: 0,
    elementId: copyTitle.id,
    summary: 'Identify duplicate',
    patch: { text: 'Copied plan' },
  });
  expect(
    (await read()).slides[2].elements.some(
      (el) => el.text === 'Quarterly plan',
    ),
  ).toBe(true);
  await op({ operation: 'navigate', slideIndex: 1 });
  const shape = await op({
    operation: 'add-shape',
    slideIndex: 1,
    shape: 'roundRect',
    x: 650,
    y: 420,
    width: 130,
    height: 100,
    text: 'A',
    textStyle: {
      align: 'center',
      vAlign: 'middle',
      fontSize: 32,
      color: '#ffffff',
    },
    shapeStyle: {
      fillColor: '#123456',
      strokeColor: '#334455',
      strokeWidth: 2,
    },
  });
  const second = await op({
    operation: 'duplicate-element',
    slideIndex: 1,
    elementId: shape.elementId,
    offsetX: 200,
    offsetY: 20,
  });
  const third = await op({
    operation: 'duplicate-element',
    slideIndex: 1,
    elementId: shape.elementId,
    offsetX: 460,
    offsetY: 40,
  });
  expect(
    new Set([shape.elementId, second.elementId, third.elementId]).size,
  ).toBe(3);
  const ids = [shape.elementId, second.elementId, third.elementId];
  await op({
    operation: 'arrange-elements',
    slideIndex: 1,
    elementIds: ids,
    arrangement: 'top',
  });
  state = await read();
  expect(
    state.slides[1].elements
      .filter((el) => ids.includes(el.id))
      .map((el) => el.y),
  ).toEqual([420, 420, 420]);
  const positions = async () =>
    (await read()).slides[1].elements
      .filter((el) => ids.includes(el.id))
      .map((el) => el.y);
  await op({ operation: 'undo' });
  expect(await positions()).toEqual([420, 420, 460]);
  await op({ operation: 'undo' });
  expect(await positions()).toEqual([420, 440, 460]);
  await op({ operation: 'redo' });
  await op({ operation: 'redo' });
  expect(await positions()).toEqual([420, 420, 420]);
  await op({
    operation: 'arrange-elements',
    slideIndex: 1,
    elementIds: ids,
    arrangement: 'distribute-horizontal',
  });
  state = await read();
  expect(
    state.slides[1].elements.find((el) => el.id === second.elementId).x,
  ).toBe(880);
  // The last insertion is selected; deleting the first must not delete the selection instead.
  await op({
    operation: 'delete-elements',
    slideIndex: 1,
    elementIds: [shape.elementId],
  });
  state = await read();
  expect(state.slides[1].elements.some((el) => el.id === shape.elementId)).toBe(
    false,
  );
  expect(state.slides[1].elements.some((el) => el.id === third.elementId)).toBe(
    true,
  );
  await op({ operation: 'undo' });
  expect(
    (await read()).slides[1].elements.some((el) => el.id === shape.elementId),
  ).toBe(true);
  await op({ operation: 'redo' });
  await op({ operation: 'delete-slide', slideIndex: 2 });
  expect((await read()).slides).toHaveLength(2);
  await op({ operation: 'undo' });
  expect((await read()).slides).toHaveLength(3);
  await op({ operation: 'navigate', slideIndex: 1 });
  await page.screenshot({ path: '.cache/operations-preview.png' });
  const frame = page.frames().find((item) => item.url().includes('/dsh-pptx'));
  expect(await frame.evaluate(() => window.__slideWrites)).toBe(0);
  const saved = await downloadPptx(page, editor);
  const archive = await JSZip.loadAsync(saved);
  const parser = new XMLParser({ ignoreAttributes: false });
  const presentation = parser.parse(
    await archive.file('ppt/presentation.xml').async('string'),
  );
  expect(presentation['p:presentation']['p:sldIdLst']['p:sldId']).toHaveLength(
    3,
  );
  const xmls = await Promise.all(
    Object.keys(archive.files)
      .filter((path) => /^ppt\/slides\/slide[0-9]+\.xml$/.test(path))
      .map((path) => archive.file(path).async('string')),
  );
  expect(xmls.some((xml) => xml.includes('Copied plan'))).toBe(true);
  expect(
    xmls.some((xml) => xml.includes('123456') && xml.includes('roundRect')),
  ).toBe(true);
  expect(archive.file('ppt/charts/chart1.xml')).not.toBeNull();
  await reopenPptx(page, editor, saved);
  const reopened = await read();
  expect(reopened.documentId).not.toBe(original.documentId);
  expect(reopened.slides).toHaveLength(3);
  expect(
    reopened.slides[0].elements.some((el) => el.text === 'Copied plan'),
  ).toBe(true);
  expect(
    reopened.slides[1].elements.filter((el) => el.text === 'A'),
  ).toHaveLength(2);
  expect(
    reopened.slides[2].elements.some((el) => el.text === 'Quarterly plan'),
  ).toBe(true);
  const duplicate = (state) => ({
    action: {
      ...base(state),
      operation: 'duplicate-slide',
      slideIndex: 0,
      summary: 'Copy first slide after reopening',
    },
  });
  const staleCopy = await send('operate_pptx', duplicate(original));
  expect(staleCopy.ok()).toBe(false);
  expect(await staleCopy.text()).toContain('Stale');
  expect((await read()).slides).toHaveLength(3);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  const freshCopy = duplicate(await read());
  await call('operate_pptx', freshCopy);
  expect((await read()).slides).toHaveLength(4);
  const repeated = await send('operate_pptx', freshCopy);
  expect(repeated.ok()).toBe(false);
  expect(await repeated.text()).toContain('Stale');
  expect((await read()).slides).toHaveLength(4);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await op({ operation: 'undo' });
  expect((await read()).slides).toHaveLength(3);
  expect(errors).toEqual([]);
});
