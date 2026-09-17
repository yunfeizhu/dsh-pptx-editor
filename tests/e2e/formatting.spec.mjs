import { downloadPptx, reopenPptx } from './viewer-files.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test('conversation formats actual text and preserves geometry through export and reopen', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const imported = await JSZip.loadAsync(
    await readFile('.cache/synthetic.pptx'),
  );
  const slideXml = await imported.file('ppt/slides/slide1.xml').async('string');
  imported.file(
    'ppt/slides/slide1.xml',
    slideXml.replace(/<p:sp>.*?<\/p:sp>/g, (shape) => {
      if (shape.includes('<a:t>Project Atlas</a:t>'))
        return shape
          .replace('indent="0" marL="0"', 'indent="-114300" marL="381000"')
          .replace(
            /<a:solidFill>.*?<\/a:solidFill>/,
            '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>',
          );
      if (shape.includes('<a:t>Synthetic presentation</a:t>'))
        return shape.replace(
          '</a:r><a:endParaRPr',
          '</a:r><a:br/><a:r><a:rPr/><a:t>Second line</a:t></a:r><a:endParaRPr',
        );
      return shape;
    }),
  );
  const fixture = [...(await imported.generateAsync({ type: 'uint8array' }))];
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
  await page.goto('/test/panel?session=formatting');
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
      data: { name, args, sessionId: 'formatting' },
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
  const title = original.slides[0].elements.find(
    (el) => el.text === 'Project Atlas',
  );
  const geometry = ({ x, y, width, height }) => ({ x, y, width, height });
  const edit = async (elementId, patch) =>
    call('edit_pptx', {
      ...base(await read()),
      slideIndex: 0,
      elementId,
      patch,
      summary: 'Format text',
    });
  const currentTitle = async () =>
    (await read()).slides[0].elements.find((el) => el.id === title.id);
  await edit(title.id, {
    textStyle: {
      align: 'center',
      vAlign: 'middle',
      fontFamily: 'Arial',
      fontSize: 40,
      color: '#112233',
      bold: false,
      italic: true,
      underline: true,
      paragraphSpacingAfter: 12,
      paragraphMarginLeft: 0,
      paragraphIndent: 0,
      lineSpacing: 1.5,
    },
  });
  expect(geometry(await currentTitle())).toEqual(geometry(title));
  expect((await currentTitle()).textStyle).toMatchObject({
    align: 'center',
    vAlign: 'middle',
  });
  const frame = page.frames().find((item) => item.url().includes('/dsh-pptx'));
  const rendered = editor.getByText('Project Atlas', { exact: true }).last();
  await expect(rendered).toBeVisible();
  const alignment = await rendered.evaluate((el) => {
    for (let node = el; node; node = node.parentElement)
      if (getComputedStyle(node).textAlign === 'center') return true;
    return false;
  });
  expect(alignment).toBe(true);
  const styles = await rendered.evaluate((el) => {
    const result = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      result.push({
        color: style.color,
        indent: style.textIndent,
        margin: style.marginLeft,
        background: style.backgroundImage,
      });
    }
    return result;
  });
  expect(styles[0].color).toBe('rgb(17, 34, 51)');
  expect(
    styles.some(
      (style) =>
        style.indent === '-12px' ||
        style.margin === '40px' ||
        style.background.includes('gradient'),
    ),
  ).toBe(false);
  await undo();
  expect(await currentTitle()).toEqual(title);
  await redo();
  expect((await currentTitle()).textStyle.align).toBe('center');
  const subtitle = original.slides[0].elements.find((el) =>
    el.text?.includes('Synthetic presentation'),
  );
  await edit(subtitle.id, { textStyle: { listType: 'numbered' } });
  await edit(subtitle.id, { textStyle: { listType: 'none' } });
  const literal = await call('add_pptx_text', {
    ...base(await read()),
    slideIndex: 0,
    summary: 'Literal list text',
    text: '1.',
    x: 700,
    y: 300,
    width: 200,
    height: 50,
    textStyle: { listType: 'numbered' },
  });
  await edit(literal.elementId, { textStyle: { listType: 'bullet' } });
  await edit(literal.elementId, { textStyle: { listType: 'none' } });
  expect(
    (await read()).slides[0].elements.find((el) => el.id === literal.elementId)
      .text,
  ).toBe('1.');
  const added = await call('add_pptx_text', {
    ...base(await read()),
    slideIndex: 0,
    summary: 'List',
    text: 'One\nTwo',
    x: 700,
    y: 400,
    width: 400,
    height: 200,
    textStyle: { align: 'right', listType: 'numbered' },
  });
  await expect(editor.getByText('One', { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: '.cache/formatting-preview.png' });
  expect(await frame.evaluate(() => window.__slideWrites)).toBe(0);
  const saved = await downloadPptx(page, editor);
  const archive = await JSZip.loadAsync(saved);
  const xml = await archive.file('ppt/slides/slide1.xml').async('string');
  expect(xml).toContain('algn="ctr"');
  expect(xml).toContain('anchor="ctr"');
  expect(xml).toContain('112233');
  expect(xml).toContain('sz="3000"');
  expect(xml).toContain('a:buAutoNum');
  expect(xml).toContain('One');
  expect(xml).toContain('Two');
  expect(xml.match(/<a:br\b/g)).toHaveLength(1);
  expect(xml).not.toContain('<a:gradFill');
  expect(xml).toContain('<a:t>1.</a:t>');
  await reopenPptx(page, editor, saved);
  const reopened = await read();
  expect(reopened.documentId).not.toBe(original.documentId);
  const recovered = reopened.slides[0].elements.find(
    (el) => el.text === 'Project Atlas',
  );
  expect(geometry(recovered)).toEqual(geometry(title));
  expect(recovered.textStyle).toMatchObject({
    align: 'center',
    vAlign: 'middle',
    fontSize: 40,
    color: '#112233',
    italic: true,
    underline: true,
    paragraphMarginLeft: 0,
    paragraphIndent: 0,
  });
  expect(
    reopened.slides[0].elements.some(
      (el) => el.text?.includes('One') && el.text.includes('Two'),
    ),
  ).toBe(true);
  expect(added.elementId).toBeTruthy();
  const list = reopened.slides[0].elements.find((el) =>
    el.text?.includes('One'),
  );
  await edit(list.id, { textStyle: { listType: 'none' } });
  const plain = (await read()).slides[0].elements.find(
    (el) => el.id === list.id,
  );
  expect(plain.text).toBe('One\nTwo');
  expect(
    plain.textRuns
      .filter((run) => !run.paragraphBreak)
      .map((run) => run.text)
      .join(''),
  ).toBe('OneTwo');
  const plainSaved = await downloadPptx(page, editor);
  const plainArchive = await JSZip.loadAsync(plainSaved);
  const plainXml = await plainArchive
    .file('ppt/slides/slide1.xml')
    .async('string');
  expect(plainXml).not.toContain('a:buAutoNum');
  expect(plainXml).toContain('a:buNone');
  expect(errors).toEqual([]);
});
