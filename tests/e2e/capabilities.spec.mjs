import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { downloadPptx, reopenPptx } from './viewer-files.mjs';

async function setup(page, sessionId) {
  const bytes = [...(await readFile('.cache/synthetic.pptx'))];
  await page.addInitScript((data) => {
    window.showOpenFilePicker = async () => [
      {
        name: 'synthetic.pptx',
        getFile: async () => new File([new Uint8Array(data)], 'synthetic.pptx'),
        createWritable: async () => {
          throw new Error('No original-file writes');
        },
      },
    ];
  }, bytes);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/test/panel?session=${sessionId}`);
  const editor = page.frameLocator('iframe');
  await editor.getByRole('button', { name: '打开 PPTX', exact: true }).click();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeEnabled();
  const call = async (name, args = {}) => {
    const response = await page.request.post('/test/command', {
      data: { name, args, sessionId },
    });
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
      summary: 'Capability regression',
    };
  };
  const op = async (action) =>
    call('operate_pptx', { action: { ...(await base()), ...action } });
  const edit = async (elementId, patch) =>
    call('edit_pptx', { ...(await base()), slideIndex: 0, elementId, patch });
  const text = async (value, textStyle, index) =>
    call('add_pptx_text', {
      ...(await base()),
      slideIndex: 0,
      text: value,
      textStyle,
      x: 600,
      y: 30 + index * 150,
      width: 480,
      height: 140,
    });
  return { editor, read, op, edit, text, errors, call, base };
}

test('authorized chat image insertion and crop effects survive native save', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { editor, read, op, errors, call, base } = await setup(
    page,
    'capability-image',
  );
  const images = await call('list_pptx_images');
  expect(images.images).toHaveLength(1);
  const added = await call('add_pptx_image', {
    ...(await base()),
    slideIndex: 0,
    attachmentId: images.images[0].attachmentId,
    x: 600,
    y: 100,
    width: 200,
    height: 200,
    altText: 'Uploaded test image',
  });
  await op({
    operation: 'update-image',
    slideIndex: 0,
    elementId: added.elementId,
    update: {
      cropLeft: 0.1,
      cropRight: 0.2,
      cropTop: 0.1,
      cropBottom: 0.2,
      cropShape: 'ellipse',
      effects: { alphaModFix: 80, brightness: 10, contrast: 20 },
    },
  });
  const bytes = await downloadPptx(page, editor);
  await reopenPptx(page, editor, bytes);
  const picture = (await read()).slides[0].elements.find(
    (el) => el.image?.altText === 'Uploaded test image',
  );
  expect(picture).toMatchObject({
    image: {
      cropLeft: 0.1,
      cropRight: 0.2,
      cropTop: 0.1,
      cropBottom: 0.2,
      cropShape: 'ellipse',
      effects: { alphaModFix: 80, brightness: 10, contrast: 20 },
    },
  });
  expect(errors).toEqual([]);
});

test('table conversation commands preserve cells, undo and native serialization', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { editor, read, op, errors } = await setup(page, 'capability-table');
  const inserted = await op({
    operation: 'add-table',
    slideIndex: 0,
    x: 600,
    y: 300,
    width: 500,
    height: 180,
    table: {
      rows: [
        ['Item', 'Score'],
        ['Alpha', '10'],
        ['Beta', '20'],
      ],
      firstRowHeader: true,
    },
  });
  const update = (value) =>
    op({
      operation: 'update-table',
      slideIndex: 0,
      elementId: inserted.elementId,
      update: value,
    });
  await update({
    kind: 'cells',
    cells: [
      {
        row: 1,
        column: 1,
        text: '42',
        style: {
          bold: true,
          color: '#000000',
          backgroundColor: '#FFFF00',
          align: 'center',
          fontSize: 18,
        },
      },
    ],
  });
  await update({ kind: 'insert-row', index: 3 });
  await op({ operation: 'undo' });
  expect(
    (await read()).slides[0].elements.find((el) => el.id === inserted.elementId)
      .table.rowCount,
  ).toBe(3);
  await op({ operation: 'redo' });
  await update({
    kind: 'cells',
    cells: [
      { row: 3, column: 0, text: 'Gamma' },
      { row: 3, column: 1, text: '30' },
    ],
  });
  const bytes = await downloadPptx(page, editor);
  const zip = await JSZip.loadAsync(bytes);
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');
  expect(slide).toContain('Gamma');
  expect(slide).toContain('FFFF00');
  await reopenPptx(page, editor, bytes);
  const table = (await read()).slides[0].elements.find(
    (el) => el.type === 'table',
  ).table;
  expect(table.rowCount).toBe(4);
  expect(table.rows[1].cells[1]).toMatchObject({
    text: '42',
    style: {
      bold: true,
      color: '#000000',
      backgroundColor: '#FFFF00',
      align: 'center',
      fontSize: 18,
    },
  });
  expect(table.rows[3].cells.map((cell) => cell.text)).toEqual(['Gamma', '30']);
  expect(errors).toEqual([]);
});

test('chart commands update imported workbooks and create persistent chart data', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { editor, read, op, errors } = await setup(page, 'capability-chart');
  const original = (await read()).slides[1].elements.find(
    (el) => el.type === 'chart',
  );
  await op({
    operation: 'update-chart',
    slideIndex: 1,
    elementId: original.id,
    update: {
      title: 'Updated data',
      categories: ['Q1', 'Q2', 'Q3'],
      series: [{ name: 'Progress', values: [42, 60, 80] }],
      style: { hasLegend: true },
    },
  });
  await op({ operation: 'undo' });
  expect(
    (await read()).slides[1].elements.find((el) => el.id === original.id).chart
      .series[0].values,
  ).toEqual([10, 20, 30]);
  await op({ operation: 'redo' });
  for (const chartType of ['bar', 'line', 'pie', 'doughnut', 'area', 'radar']) {
    await op({
      operation: 'add-chart',
      slideIndex: 1,
      x: 600,
      y: 100,
      width: 400,
      height: 300,
      chart: {
        chartType,
        title: `Created ${chartType}`,
        style: { hasLegend: true, legendPosition: 'b', hasDataLabels: true },
        categories: ['A', 'B'],
        series: [
          {
            name: 'Series',
            values: [10, 20],
          },
        ],
      },
    });
  }
  for (const chartType of ['bar', 'line', 'pie', 'doughnut', 'area', 'radar']) {
    await expect(
      editor
        .getByRole('main', { name: '幻灯片编辑器' })
        .getByText(`Created ${chartType}`, { exact: true }),
    ).toBeVisible();
  }
  const bytes = await downloadPptx(page, editor);
  const zip = await JSZip.loadAsync(bytes);
  const workbooks = Object.keys(zip.files).filter(
    (name) => name.startsWith('ppt/embeddings/') && name.endsWith('.xlsx'),
  );
  expect(workbooks.length).toBeGreaterThan(0);
  const workbook = await JSZip.loadAsync(
    await zip.file(workbooks[0]).async('uint8array'),
  );
  const sheet = await workbook.file('xl/worksheets/sheet1.xml').async('string');
  expect(sheet).toContain('42');
  expect(sheet).toContain('80');
  await reopenPptx(page, editor, bytes);
  const charts = (await read()).slides[1].elements.filter(
    (el) => el.type === 'chart',
  );
  await op({ operation: 'navigate', slideIndex: 1 });
  for (const chartType of ['bar', 'line', 'pie', 'doughnut', 'area', 'radar']) {
    await expect(
      editor
        .getByRole('main', { name: '幻灯片编辑器' })
        .getByText(`Created ${chartType}`, { exact: true }),
    ).toBeVisible();
  }
  expect(charts).toHaveLength(7);
  expect(charts[0].chart).toMatchObject({
    title: 'Updated data',
    categories: ['Q1', 'Q2', 'Q3'],
    series: [{ name: 'Progress', values: [42, 60, 80] }],
  });
  for (const chartType of ['bar', 'line', 'pie', 'doughnut', 'area', 'radar']) {
    expect(
      charts.find((el) => el.chart.title === `Created ${chartType}`).chart,
    ).toMatchObject({
      chartType,
      categories: ['A', 'B'],
      series: [{ name: 'Series', values: [10, 20] }],
      style: {
        hasLegend: true,
        legendPosition: 'b',
        hasDataLabels: true,
      },
    });
  }
  expect(errors).toEqual([]);
});

test('all exposed text formatting fields survive native save and reopen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { editor, read, text, errors } = await setup(page, 'capability-format');
  const styles = ['left', 'center', 'right', 'justify'].map((align, index) => ({
    fontFamily: 'Arial',
    fontSize: 24,
    color: '#123456',
    bold: index % 2 === 0,
    italic: index % 2 === 1,
    underline: index % 2 === 0,
    strikethrough: index % 2 === 1,
    align,
    vAlign: ['top', 'middle', 'bottom', 'top'][index],
    lineSpacing: 1.5,
    paragraphSpacingBefore: 8,
    paragraphSpacingAfter: 12,
    paragraphMarginLeft: 20,
    paragraphMarginRight: 10,
    paragraphIndent: -4,
    bodyInsetLeft: 6,
    bodyInsetRight: 8,
    bodyInsetTop: 10,
    bodyInsetBottom: 12,
  }));
  for (const [index, style] of styles.entries()) {
    await text(`Format ${index}\nSecond line`, style, index);
  }
  const saved = await downloadPptx(page, editor);
  await writeFile('.cache/capability-format.pptx', saved);
  await reopenPptx(page, editor, saved);
  const state = await read();
  for (const [index, style] of styles.entries()) {
    const element = state.slides[0].elements.find(
      (el) => el.text === `Format ${index}\nSecond line`,
    );
    expect(element, `Text box ${index} survives`).toBeDefined();
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === 'number')
        expect
          .soft(element.textStyle[key], `Box ${index}: ${key}`)
          .toBeCloseTo(value, 2);
      else
        expect
          .soft(element.textStyle[key] ?? false, `Box ${index}: ${key}`)
          .toBe(value);
    }
    const rendered = editor
      .getByText(`Format ${index}`, { exact: true })
      .last();
    await expect(rendered).toBeVisible();
    expect
      .soft(
        await rendered.evaluate((el) => {
          for (let node = el; node; node = node.parentElement)
            if (getComputedStyle(node).marginLeft === '20px') return true;
          return false;
        }),
        `Box ${index}: rendered paragraph indentation`,
      )
      .toBe(true);
    expect
      .soft(await rendered.evaluate((el) => getComputedStyle(el).color))
      .toBe('rgb(18, 52, 86)');
  }
  expect(errors).toEqual([]);
});

test('imported mixed paragraphs and subsequent native font edits retain accurate readback', async ({
  page,
}) => {
  const { editor, read, edit, errors } = await setup(
    page,
    'capability-paragraphs',
  );
  const archive = await JSZip.loadAsync(
    await readFile('.cache/synthetic.pptx'),
  );
  const path = 'ppt/slides/slide1.xml';
  const xml = await archive.file(path).async('string');
  let replaced = false;
  archive.file(
    path,
    xml.replace(/<p:sp>.*?<\/p:sp>/g, (shape) => {
      if (!shape.includes('<a:t>Project Atlas</a:t>')) return shape;
      replaced = true;
      return shape.replace(
        /<a:p>.*?<\/a:p>/,
        [
          '<a:p><a:pPr algn="ctr" marL="190500" marR="95250" indent="-38100"/>',
          '<a:r><a:rPr b="1"/><a:t>First</a:t></a:r><a:r><a:rPr i="1"/><a:t> rich</a:t></a:r>',
          '<a:br/><a:r><a:t> wrapped</a:t></a:r></a:p>',
          '<a:p><a:pPr algn="r" marL="0" marR="0" indent="0"/>',
          '<a:r><a:t>Second</a:t></a:r><a:r><a:rPr i="1"/><a:t> rich</a:t></a:r></a:p>',
        ].join(''),
      );
    }),
  );
  expect(replaced).toBe(true);
  await reopenPptx(
    page,
    editor,
    await archive.generateAsync({ type: 'uint8array' }),
  );
  const state = await read();
  const title = state.slides[0].elements.find((el) =>
    el.text?.startsWith('First'),
  );
  const runs = title.textRuns;
  for (const text of ['First', ' rich', ' wrapped']) {
    expect(runs.find((run) => run.text === text).style).toMatchObject({
      align: 'center',
      paragraphMarginLeft: 20,
      paragraphMarginRight: 10,
      paragraphIndent: -4,
    });
  }
  const second = runs.findIndex((run) => run.text === 'Second');
  for (const run of runs.slice(second).filter((run) => !run.paragraphBreak))
    expect(run.style).toMatchObject({
      align: 'right',
      paragraphMarginLeft: 0,
      paragraphMarginRight: 0,
      paragraphIndent: 0,
    });
  await edit(title.id, { textStyle: { bold: true } });
  const text = editor
    .getByRole('main', { name: '幻灯片编辑器' })
    .getByText('First', { exact: true });
  await text.click();
  await editor
    .getByRole('toolbar', { name: '演示工具栏' })
    .getByRole('button', { name: '加粗', exact: true })
    .click();
  expect(
    (await read()).slides[0].elements.find((el) => el.id === title.id).textStyle
      .bold,
  ).toBe(false);
  await expect(text).toHaveCSS('font-weight', '400');
  expect(errors).toEqual([]);
});

test('all exposed shape presets, fills, outlines and transforms survive reopening', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { editor, read, op, edit, errors } = await setup(
    page,
    'capability-shape',
  );
  const shapes = [
    'rect',
    'roundRect',
    'ellipse',
    'triangle',
    'diamond',
    'hexagon',
    'chevron',
    'rightArrow',
  ];
  for (const [index, shape] of shapes.entries()) {
    const added = await op({
      operation: 'add-shape',
      slideIndex: 0,
      shape,
      x: 580 + (index % 4) * 160,
      y: 30 + Math.floor(index / 4) * 250,
      width: 130,
      height: 170,
      text: shape,
      textStyle: {
        align: 'center',
        vAlign: 'middle',
        color: '#102030',
        fontSize: 18,
      },
      shapeStyle: {
        fillColor: '#ABCDEF',
        fillMode: index % 2 ? 'none' : 'solid',
        strokeColor: '#345678',
        strokeWidth: 3,
      },
    });
    await edit(added.elementId, {
      rotation: 15,
      flipHorizontal: true,
      flipVertical: true,
    });
  }
  const saved = await downloadPptx(page, editor);
  const zip = await JSZip.loadAsync(saved);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  for (const shape of shapes)
    expect.soft(xml, shape).toContain(`prst="${shape}"`);
  await reopenPptx(page, editor, saved);
  const state = await read();
  for (const [index, shape] of shapes.entries()) {
    const el = state.slides[0].elements.find((item) => item.text === shape);
    expect(el, shape).toBeDefined();
    expect.soft(el, shape).toMatchObject({
      rotation: 15,
      flipHorizontal: true,
      flipVertical: true,
      width: 130,
      height: 170,
    });
    expect.soft(el.shapeStyle, shape).toMatchObject({
      fillMode: index % 2 ? 'none' : 'solid',
      strokeColor: '#345678',
      strokeWidth: 3,
    });
    if (index % 2 === 0)
      expect.soft(el.shapeStyle.fillColor, shape).toBe('#ABCDEF');
  }
  expect(errors).toEqual([]);
});

test('all eight element arrangements use the intended bounds and gaps', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { read, op, edit, errors } = await setup(page, 'capability-arrange');
  const input = [
    { x: 500, y: 50, width: 40, height: 30 },
    { x: 600, y: 180, width: 60, height: 50 },
    { x: 850, y: 430, width: 100, height: 80 },
  ];
  const ids = [];
  for (const geometry of input)
    ids.push(
      (
        await op({
          operation: 'add-shape',
          slideIndex: 0,
          shape: 'rect',
          ...geometry,
        })
      ).elementId,
    );
  const cases = [
    ['left', 'x', [500, 500, 500]],
    ['center', 'x', [705, 695, 675]],
    ['right', 'x', [910, 890, 850]],
    ['top', 'y', [50, 50, 50]],
    ['middle', 'y', [265, 255, 240]],
    ['bottom', 'y', [480, 460, 430]],
    ['distribute-horizontal', 'x', [500, 665, 850]],
    ['distribute-vertical', 'y', [50, 230, 430]],
  ];
  for (const [arrangement, axis, expected] of cases) {
    for (const [index, id] of ids.entries()) await edit(id, input[index]);
    await op({
      operation: 'arrange-elements',
      slideIndex: 0,
      elementIds: ids,
      arrangement,
    });
    const state = await read();
    expect
      .soft(
        ids.map(
          (id) => state.slides[0].elements.find((el) => el.id === id)[axis],
        ),
        arrangement,
      )
      .toEqual(expected);
  }
  expect(errors).toEqual([]);
});
