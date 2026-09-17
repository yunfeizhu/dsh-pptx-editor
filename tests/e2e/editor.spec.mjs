import { downloadPptx, openViewerFile, reopenPptx } from './viewer-files.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

test('real editor: direct edit, undo, redo, stale rejection, save and reopen', async ({
  page,
  request,
}) => {
  const fixture = [...(await readFile('.cache/synthetic.pptx'))];
  // Only the OS picker is doubled. Rendering, history and serialization are real.
  await page.addInitScript((initial) => {
    window.showOpenFilePicker = async () => [
      {
        name: 'synthetic.pptx',
        getFile: async () =>
          new File([new Uint8Array(initial)], 'synthetic.pptx'),
        createWritable: async () => {
          throw new Error('Native download must not overwrite the source');
        },
      },
    ];
  }, fixture);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  await page.goto('/test/panel');
  const editor = page.frameLocator('iframe');
  await openViewerFile(editor);
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeEnabled({ timeout: 30_000 });
  const call = async (name, args = {}) => {
    const result = await request.post('/test/command', {
      data: { name, args },
    });
    const data = await result.json();
    expect(result.ok(), JSON.stringify(data)).toBe(true);
    return data;
  };
  const read = () => call('read_pptx');
  // DSH hides its sidebar without removing layout boxes. A reopen must await a visible canvas.
  for (const hidden of ['visibility', 'translate']) {
    await page.locator('section').evaluate((el, mode) => {
      el.style.visibility = mode === 'visibility' ? 'hidden' : 'visible';
      el.style.transform = mode === 'translate' ? 'translateX(200vw)' : '';
    }, hidden);
    expect(
      await page
        .locator('iframe')
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(0);
    const refused = page.waitForRequest(
      (req) =>
        req.url().endsWith('/exchange') &&
        req.postDataJSON()?.reply?.result?.error ===
          'PPTX panel is not visible yet',
    );
    const opening = call('open_pptx');
    await refused;
    await page.locator('section').evaluate((el) => {
      el.style.visibility = 'visible';
      el.style.transform = '';
    });
    expect((await opening).preview.status).toBe('ready');
  }
  await expect(editor.locator('.pptx-bar')).toHaveCount(0);
  await expect(
    editor.getByRole('button', { name: '保存到原文件' }),
  ).toHaveCount(0);
  await expect(editor.locator('html')).toHaveCSS(
    '--pptx-background',
    '#f8fafc',
  );
  await page
    .locator('iframe')
    .screenshot({ path: '.cache/ui-light-chinese.png' });
  await editor.getByText('Project Atlas', { exact: true }).last().dblclick();
  await editor.locator('[contenteditable="true"]').fill('Manual draft');
  await editor.getByRole('tab', { name: '开始', exact: true }).click();
  expect(
    (await read()).slides[0].elements.some(
      (element) => element.text === 'Manual draft',
    ),
  ).toBe(true);
  await openViewerFile(editor);
  const leaveDialog = editor.locator('dialog.pptx-confirm');
  await expect(
    leaveDialog.getByRole('button', { name: '取消', exact: true }),
  ).toBeFocused();
  const assertCentered = async () => {
    const layout = await leaveDialog.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        viewport: [innerWidth, innerHeight],
        width: rect.width,
      };
    });
    expect(Math.abs(layout.x - layout.viewport[0] / 2)).toBeLessThan(1);
    expect(Math.abs(layout.y - layout.viewport[1] / 2)).toBeLessThan(1);
    expect(layout.width).toBeLessThanOrEqual(layout.viewport[0] - 32);
  };
  await assertCentered();
  await leaveDialog
    .getByRole('button', { name: '取消', exact: true })
    .press('Tab');
  await expect(
    leaveDialog.getByRole('button', { name: '放弃修改并打开' }),
  ).toBeFocused();
  await leaveDialog
    .getByRole('button', { name: '放弃修改并打开' })
    .press('Shift+Tab');
  await expect(
    leaveDialog.getByRole('button', { name: '取消', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 560, height: 800 });
  await assertCentered();
  await page.screenshot({ path: '.cache/ui-narrow-dialog.png' });
  await leaveDialog.press('Escape');
  await expect(leaveDialog).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await editor
    .getByRole('button', { name: /^撤[销消]/ })
    .first()
    .click();
  const before = await read();
  expect(before.slides).toHaveLength(2);
  const title = before.slides[0].elements.find(
    (element) => element.text === 'Project Atlas',
  );
  expect(title).toBeDefined();
  const edit = {
    documentId: before.documentId,
    version: before.version,
    slideIndex: 0,
    elementId: title.id,
    summary: 'Rename the synthetic cover',
    patch: { text: 'Project Nova', x: title.x + 24 },
  };
  const applied = await call('edit_pptx', edit);
  expect(applied.status).toBe('applied');
  expect(applied.version).toBeGreaterThan(before.version);
  await expect(editor.getByRole('button', { name: '确认应用' })).toHaveCount(0);
  expect(
    (await read()).slides[0].elements.find((element) => element.id === title.id)
      .text,
  ).toBe('Project Nova');
  // Host language changes update the plugin and viewer without remounting the document.
  const identity = (await read()).documentId;
  await page.getByRole('button', { name: 'DSH English', exact: true }).click();
  await expect(
    editor.getByRole('combobox', { name: 'Language / 语言' }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole('tab', { name: 'Home', exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Save', exact: true }).first(),
  ).toBeVisible();
  await editor.getByRole('tab', { name: 'File', exact: true }).click();
  await editor.getByRole('button', { name: 'Options', exact: true }).click();
  await editor.getByRole('button', { name: 'General', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Vermilion Light', exact: true })
    .click();
  await editor.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(
    editor.getByRole('tab', { name: 'Home', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.cache/ui-light-english.png' });
  await openViewerFile(editor);
  await expect(leaveDialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(
    leaveDialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await leaveDialog.press('Escape');
  await editor.getByRole('tab', { name: 'File', exact: true }).click();
  await editor.getByRole('button', { name: 'Options', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Vermilion Dark', exact: true })
    .click();
  await editor.getByRole('button', { name: 'Default', exact: true }).click();
  const residual = await editor.locator('html').evaluate((el) => ({
    color: el.style.getPropertyValue('--color-card'),
    radius: el.style.getPropertyValue('--radius-lg'),
  }));
  expect(residual).toEqual({ color: '', radius: '' });
  await editor.getByRole('button', { name: 'Light', exact: true }).click();
  await editor.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'DSH 中文', exact: true }).click();
  await expect(
    editor.getByRole('tab', { name: '开始', exact: true }),
  ).toBeVisible();
  const afterPreferences = await read();
  expect(afterPreferences.documentId).toBe(identity);
  expect(
    afterPreferences.slides[0].elements.find(
      (element) => element.id === title.id,
    ).text,
  ).toBe('Project Nova');
  await editor
    .getByRole('button', { name: /^撤[销消]/ })
    .first()
    .click();
  expect(
    (await read()).slides[0].elements.find((element) => element.id === title.id)
      .text,
  ).toBe('Project Atlas');
  await editor.getByRole('button', { name: /^重做/ }).first().click();
  const after = await read();
  expect(
    after.slides[0].elements.find((element) => element.id === title.id).text,
  ).toBe('Project Nova');
  await editor
    .getByRole('button', { name: /^撤[销消]/ })
    .first()
    .click();
  const stale = await request.post('/test/command', {
    data: {
      name: 'edit_pptx',
      args: {
        ...edit,
        version: after.version,
        patch: { text: 'Should not apply' },
      },
    },
  });
  expect(stale.ok()).toBe(false);
  expect(await stale.text()).toContain('Stale');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  expect(
    (await read()).slides[0].elements.find((element) => element.id === title.id)
      .text,
  ).toBe('Project Atlas');
  await editor.getByRole('button', { name: /^重做/ }).first().click();
  const retained = await read();
  await page.getByRole('button', { name: 'Switch tab' }).click();
  await page.getByRole('button', { name: 'Switch tab' }).click();
  expect((await read()).documentId).toBe(retained.documentId);
  await expect(
    editor.getByRole('button', { name: /^撤[销消]/ }).first(),
  ).toBeEnabled();
  const saved = await downloadPptx(page, editor);
  const archive = await JSZip.loadAsync(new Uint8Array(saved));
  expect(await archive.file('ppt/slides/slide1.xml').async('string')).toContain(
    'Project Nova',
  );
  const original = await JSZip.loadAsync(new Uint8Array(fixture));
  for (const path of ['ppt/media/image-2-1.png']) {
    expect(archive.file(path), path).not.toBeNull();
    expect(await archive.file(path).async('uint8array')).toEqual(
      await original.file(path).async('uint8array'),
    );
  }
  const parser = new XMLParser({ ignoreAttributes: false });
  const chart = (xml) =>
    parser.parse(xml)['c:chartSpace']['c:chart']['c:plotArea']['c:barChart'][
      'c:ser'
    ];
  const workbookPath = 'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx';
  const originalBook = await JSZip.loadAsync(
    await original.file(workbookPath).async('uint8array'),
  );
  const savedBook = await JSZip.loadAsync(
    await archive.file(workbookPath).async('uint8array'),
  );
  const cells = async (book) => {
    const text = (node) => (typeof node === 'object' ? node['#text'] : node);
    const strings = parser
      .parse(await book.file('xl/sharedStrings.xml').async('string'))
      .sst.si.map((entry) => text(entry.t));
    return parser
      .parse(await book.file('xl/worksheets/sheet1.xml').async('string'))
      .worksheet.sheetData.row.flatMap((row) =>
        row.c.map((cell) => [
          cell['@_r'],
          cell['@_t'] === 's'
            ? strings[cell.v]
            : cell['@_t'] === 'inlineStr'
              ? text(cell.is.t)
              : cell.v,
        ]),
      );
  };
  expect(await cells(savedBook)).toEqual(await cells(originalBook));
  const originalSeries = chart(
    await original.file('ppt/charts/chart1.xml').async('string'),
  );
  const savedSeries = chart(
    await archive.file('ppt/charts/chart1.xml').async('string'),
  );
  for (const key of ['c:cat', 'c:val', 'c:tx'])
    expect(savedSeries[key]).toEqual(originalSeries[key]);
  expect(
    await archive.file('ppt/notesSlides/notesSlide1.xml').async('string'),
  ).toContain('Synthetic speaker notes');
  expect(await archive.file('ppt/slides/slide2.xml').async('string')).toContain(
    'Quarter',
  );
  await reopenPptx(
    page,
    editor,
    saved,
    `synthetic-${'quarterly_'.repeat(20)}.pptx`,
  );
  expect(
    (await read()).slides[0].elements.find(
      (element) => element.text === 'Project Nova',
    ),
  ).toBeDefined();
  const final = await read();
  await call('edit_pptx', {
    ...edit,
    documentId: final.documentId,
    version: final.version,
    patch: { text: 'Recovery test' },
  });
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: '继续编辑',
      exact: true,
    }),
  ).toBeVisible();
  const notice = page.locator('.pptx-recovery-notice');
  await expect(notice.getByRole('status')).toContainText('文稿已保留');
  await expect(notice).not.toContainText(' / ');
  await expect(notice).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const restoreButton = notice.getByRole('button', {
    name: '继续编辑',
    exact: true,
  });
  const border = await restoreButton.evaluate(
    (el) => getComputedStyle(el).border,
  );
  await restoreButton.hover();
  await expect(restoreButton).toHaveCSS('border', border);
  await notice.screenshot({ path: '.cache/retained-notice-light.png' });
  await page.getByRole('button', { name: 'DSH English', exact: true }).click();
  await expect(
    notice.getByRole('button', { name: 'Continue editing', exact: true }),
  ).toBeVisible();
  await expect(notice).not.toContainText('文稿已保留');
  await page.setViewportSize({ width: 390, height: 720 });
  expect(await notice.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  for (const button of await notice.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('body').evaluate((el) => {
    el.style.setProperty('--dsw-alias-bg-base', '#171717');
    el.style.setProperty('--dsw-alias-label-primary', '#fafafa');
    el.style.setProperty('--dsw-alias-label-secondary', '#aaa');
  });
  await expect(notice).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await expect(notice).toHaveCSS('color', 'rgb(250, 250, 250)');
  await notice.screenshot({ path: '.cache/retained-notice-dark-narrow.png' });
  await page.locator('body').evaluate((el) => el.removeAttribute('style'));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'DSH 中文', exact: true }).click();
  await notice.getByRole('button', { name: '隐藏提示', exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open tab', exact: true }).click();
  await expect(
    editor.getByRole('main', { name: '幻灯片编辑器', exact: true }),
  ).toContainText('Recovery test');
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
  const discardDialog = page.getByRole('dialog');
  await expect(
    discardDialog.getByRole('button', { name: '取消', exact: true }),
  ).toBeFocused();
  await discardDialog
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(discardDialog).toHaveCount(0);
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(
    editor.getByRole('button', { name: /^撤[销消]/ }).first(),
  ).toBeEnabled();
  await downloadPptx(page, editor);
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await expect(page.locator('iframe')).toBeHidden();
  await page.getByRole('button', { name: 'Open tab', exact: true }).click();
  await expect(
    editor.getByRole('main', { name: '幻灯片编辑器', exact: true }),
  ).toContainText('Recovery test');
  await expect(
    editor.getByRole('button', { name: /^撤[销消]/ }).first(),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
