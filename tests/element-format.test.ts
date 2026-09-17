import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  elementPatch,
  formatProjection,
  formatText,
  type Element,
} from '../src/element-format.js';
import { editSchema, addTextSchema } from '../src/protocol.js';

const box: Extract<Element, { type: 'text' }> = {
  type: 'text',
  id: 'title',
  x: 58,
  y: 38,
  width: 768,
  height: 67,
  text: 'Heading and body',
  textStyle: { align: 'left', fontSize: 24, lineSpacingExactPt: 32 },
  textSegments: [
    {
      text: 'Heading',
      style: { bold: true, fontFamily: 'Calibri' },
      paragraphProperties: { align: 'left', lineSpacingExactPt: 32 },
    },
    { text: ' and body', style: { italic: true, color: '#123456' } },
  ],
};

it.each([false, true])(
  'reports authored paragraph indentation with explicit break flag %s',
  (explicitBreak) => {
    const imported: Extract<Element, { type: 'text' }> = {
      ...box,
      text: 'First\nSecond',
      textStyle: { paragraphMarginLeft: 0, align: 'left' },
      paragraphIndents: [
        { marginLeft: 20, indent: -4 },
        { marginLeft: 0, indent: 0 },
      ],
      textSegments: [
        {
          text: 'First',
          style: { paragraphMarginLeft: 0 },
          paragraphProperties: { paragraphMarginLeft: 20, align: 'center' },
        },
        {
          text: '\n',
          style: {},
          ...(explicitBreak ? { isParagraphBreak: true } : {}),
        },
        {
          text: 'Second',
          style: { paragraphMarginLeft: 20 },
          paragraphProperties: { paragraphMarginLeft: 0, align: 'right' },
        },
      ],
    };
    const snapshot = structuredClone(imported);
    const result = formatProjection(imported);
    expect(result.textStyle).toMatchObject({
      paragraphMarginLeft: 20,
      paragraphIndent: -4,
      align: 'center',
    });
    expect(result.textRuns?.[0]?.style).toMatchObject({
      paragraphMarginLeft: 20,
      paragraphIndent: -4,
    });
    expect(result.textRuns?.[2]?.style).toMatchObject({
      paragraphMarginLeft: 0,
      paragraphIndent: 0,
      align: 'right',
    });
    expect(imported).toEqual(snapshot);
  },
);

it('inherits paragraph metadata across rich runs and soft breaks without leaking into the next paragraph', () => {
  const result = formatProjection({
    ...box,
    textSegments: [
      {
        text: 'First',
        style: {},
        paragraphProperties: { align: 'center', paragraphMarginRight: 12 },
      },
      { text: ' bold', style: { bold: true, align: 'left' } },
      { text: '\n', style: {}, isLineBreak: true },
      { text: ' wrapped', style: { italic: true } },
      { text: '\n', style: {} },
      { text: 'Second', style: { align: 'right' } },
    ],
  });
  for (const index of [0, 1, 2, 3]) {
    expect(result.textRuns?.[index]?.style).toMatchObject({
      align: 'center',
      paragraphMarginRight: 12,
    });
    expect(result.textRuns?.[index]?.paragraphBreak).toBe(false);
  }
  expect(result.textRuns?.[1]?.style.bold).toBe(true);
  expect(result.textRuns?.[3]?.style.italic).toBe(true);
  expect(result.textRuns?.[4]?.paragraphBreak).toBe(true);
  expect(result.textRuns?.[5]?.style).toEqual({ align: 'right' });
});

it('does not let paragraph metadata override later native font and body edits', () => {
  const prior = formatText(box, {
    bold: true,
    color: '#112233',
    bodyInsetLeft: 8,
    align: 'center',
  });
  const native = { bold: false, color: '#000000', bodyInsetLeft: 12 };
  const result = formatProjection({
    ...box,
    ...prior,
    textStyle: { ...prior.textStyle, ...native },
    textSegments: prior.textSegments.map((run) => ({
      ...run,
      style: { ...run.style, ...native },
    })),
  });
  expect(result.textStyle).toMatchObject({ ...native, align: 'center' });
  for (const run of result.textRuns ?? [])
    expect(run.style).toMatchObject({ ...native, align: 'center' });
});

it('centers actual paragraphs while retaining geometry, rich runs and unrelated styles', () => {
  const before = structuredClone(box);
  const patch = elementPatch(box, {
    textStyle: { align: 'center', vAlign: 'middle', lineSpacing: 1.5 },
  });
  expect(patch).toMatchObject({
    textStyle: { align: 'center', vAlign: 'middle', lineSpacing: 1.5 },
  });
  expect(patch).not.toHaveProperty('x');
  expect(patch).not.toHaveProperty('width');
  const actual = { ...box, ...patch } as typeof box;
  expect(actual.textSegments?.[0]).toMatchObject({
    text: 'Heading',
    style: { bold: true, align: 'center' },
    paragraphProperties: { align: 'center' },
  });
  expect(actual.textSegments?.[1]).toMatchObject({
    text: ' and body',
    style: { italic: true, color: '#123456' },
  });
  expect(actual.textStyle).not.toHaveProperty('lineSpacingExactPt');
  expect(actual.textSegments?.[0]?.paragraphProperties).not.toHaveProperty(
    'lineSpacingExactPt',
  );
  expect(box).toEqual(before);
});

it('replaces themed color/font overrides and explicit underline without leaking metadata', () => {
  const source = {
    ...box,
    textStyle: {
      color: '#000000',
      colorRef: { scheme: 'accent1' },
      latinFontThemeToken: '+mj-lt',
      eastAsiaFontThemeToken: '+mj-ea',
      complexScriptFontThemeToken: '+mj-cs',
      scriptFallbackFont: 'Fallback',
      underlineStyle: 'dbl',
    },
  } as typeof box;
  const actual = formatText(source, {
    fontFamily: 'Arial',
    color: '#112233',
    underline: false,
    italic: false,
    strikethrough: true,
  });
  expect(actual.textStyle).toMatchObject({
    fontFamily: 'Arial',
    eastAsiaFont: 'Arial',
    complexScriptFont: 'Arial',
    color: '#112233',
    underline: false,
    underlineExplicitNone: true,
  });
  for (const key of [
    'colorRef',
    'colorXml',
    'latinFontThemeToken',
    'eastAsiaFontThemeToken',
    'complexScriptFontThemeToken',
    'scriptFallbackFont',
    'underlineStyle',
  ])
    expect(actual.textStyle).not.toHaveProperty(key);
  expect(
    formatProjection({ ...source, ...actual }).textStyle,
  ).not.toHaveProperty('underlineExplicitNone');
  expect(
    formatText(source, { underline: true }).textStyle.underlineExplicitNone,
  ).toBe(false);
});

it('formats paragraphs as numbered/bullet lists and removes previous bullet metadata', () => {
  const source = {
    ...box,
    text: 'One\nTwo',
    textSegments: [{ text: 'One\nTwo', style: { bold: true } }],
  };
  const numbered = formatText(source, { listType: 'numbered' });
  expect(numbered.textSegments.map((s) => s.bulletInfo)).toEqual([
    { autoNumType: 'arabicPeriod', autoNumStartAt: 1, paragraphIndex: 0 },
    undefined,
    undefined,
    { autoNumType: 'arabicPeriod', autoNumStartAt: 1, paragraphIndex: 1 },
    undefined,
  ]);
  const bulleted = formatText(
    { ...source, ...numbered },
    { listType: 'bullet' },
  );
  expect(bulleted.textSegments[0]?.bulletInfo).toEqual({ char: '•' });
  const plain = formatText({ ...source, ...bulleted }, { listType: 'none' });
  expect(plain.textSegments[0]?.bulletInfo).toEqual({ none: true });
  expect(plain.textSegments[2]?.bulletInfo).toEqual({ none: true });
  expect(plain.textSegments[2]?.style.bold).toBe(true);
  expect(
    formatText(box, { listType: 'bullet' }).textSegments[2]?.bulletInfo,
  ).toBeUndefined();
});

it('formats empty boxes, replaces content explicitly, and supports shape fills/outlines', () => {
  const empty = { ...box };
  delete empty.textSegments;
  delete empty.textStyle;
  delete empty.text;
  expect(formatText(empty, { bold: false }).textSegments).toEqual([
    { text: '', style: { bold: false } },
  ]);
  expect(elementPatch(empty, { text: 'New' })).toMatchObject({
    text: 'New',
    textSegments: [{ text: 'New', style: {} }],
  });
  expect(
    elementPatch(box, { text: 'New\nBody', textStyle: { align: 'right' } }),
  ).toMatchObject({ text: 'New\nBody', textStyle: { align: 'right' } });
  const themed = {
    ...box,
    shapeStyle: {
      fillColorRef: { scheme: 'accent1' },
      strokeColorRef: { scheme: 'accent2' },
      fillMode: 'gradient',
    },
  } as typeof box;
  expect(
    elementPatch(themed, {
      shapeStyle: {
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 2,
      },
    }),
  ).toEqual({
    shapeStyle: {
      fillMode: 'solid',
      fillColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 2,
      strokeFillMode: 'solid',
      useBackgroundFill: false,
    },
  });
  expect(elementPatch(box, { shapeStyle: { fillMode: 'none' } })).toMatchObject(
    { shapeStyle: { fillMode: 'none' } },
  );
  expect(elementPatch(box, { shapeStyle: { strokeWidth: 0 } })).toMatchObject({
    shapeStyle: { strokeWidth: 0 },
  });
  expect(z.json().safeParse(formatProjection(empty)).success).toBe(true);
  expect(formatProjection(empty)).toMatchObject({
    textStyle: {},
    shapeStyle: {},
  });
});

it('converts parsed list markers without leaking numbers into text or deleting literal content', () => {
  const source = {
    ...box,
    text: '1. One\n2. Two',
    textSegments: [
      {
        text: '1. ',
        style: {},
        bulletInfo: { autoNumType: 'arabicPeriod', paragraphIndex: 0 },
      },
      { text: 'One', style: { bold: true } },
      { text: '', style: {}, isParagraphBreak: true },
      {
        text: '2.',
        style: {},
        bulletInfo: {
          autoNumType: 'arabicPeriod',
          autoNumStartAt: 1,
          paragraphIndex: 1,
        },
      },
      { text: 'Two', style: {} },
    ],
  };
  const result = formatText(source, { listType: 'none' });
  expect(result.text).toBe('One\nTwo');
  expect(result.textSegments[0]?.style.bold).toBe(true);
  const convert = (segment: NonNullable<typeof box.textSegments>[number]) =>
    formatText(
      { ...box, textSegments: [segment, { text: '', style: {} }] },
      { listType: 'bullet' },
    ).text;
  expect(convert({ text: '• ', style: {}, bulletInfo: { char: '•' } })).toBe(
    '',
  );
  expect(
    convert({ text: '📎 ', style: {}, bulletInfo: { imageRelId: 'rId1' } }),
  ).toBe('');
  expect(
    convert({ text: '📎 ', style: {}, bulletInfo: { imageDataUrl: 'data:' } }),
  ).toBe('');
  expect(
    convert({ text: '📎 ', style: {}, bulletInfo: { imageBlipFillXml: {} } }),
  ).toBe('');
  for (const segment of [
    { text: '1. ', style: {}, bulletInfo: { none: true } },
    { text: '1. ', style: {}, bulletInfo: {} },
    { text: '1. ', style: {}, bulletInfo: { autoNumType: 'arabicPeriod' } },
    {
      text: '1. ',
      style: {},
      bulletInfo: { char: '•' },
      fieldType: 'slidenum',
    },
    {
      text: '1. ',
      style: {},
      bulletInfo: { char: '•' },
      isLineBreak: true as const,
    },
    { text: '1. ', style: {}, bulletInfo: { char: '•' } },
  ])
    expect(convert(segment)).toBe('1. ');
  expect(() =>
    convert({
      text: 'a. ',
      style: {},
      bulletInfo: { autoNumType: 'alphaLcPeriod', paragraphIndex: 0 },
    }),
  ).toThrow('custom numbering');
});

it('allows geometry on non-text elements but refuses unsupported styles and arbitrary model fields', () => {
  const picture: Element = {
    type: 'image',
    id: 'image',
    x: 0,
    y: 0,
    width: 80,
    height: 60,
  };
  expect(
    elementPatch(picture, { x: 50, rotation: 45, flipHorizontal: true }),
  ).toEqual({ x: 50, rotation: 45, flipHorizontal: true });
  expect(() =>
    elementPatch(picture, { textStyle: { align: 'center' } }),
  ).toThrow('no editable text');
  expect(() =>
    elementPatch(picture, { shapeStyle: { fillMode: 'none' } }),
  ).toThrow('requires');
  expect(formatProjection(picture)).not.toHaveProperty('textStyle');
  const base = {
    documentId: crypto.randomUUID(),
    version: 0,
    summary: 'Format',
    slideIndex: 0,
    elementId: 'title',
  };
  for (const textStyle of [
    {},
    { align: 'bogus' },
    { fontSize: -1 },
    { lineSpacing: 0 },
    { color: 'url(secret)' },
    { rawXml: {} },
  ])
    expect(
      editSchema.safeParse({ ...base, patch: { textStyle } }).success,
    ).toBe(false);
  expect(
    addTextSchema.safeParse({
      documentId: base.documentId,
      version: 0,
      summary: 'New',
      slideIndex: 0,
      text: 'Hello',
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      textStyle: { align: 'center' },
    }).success,
  ).toBe(true);
});

it('preserves literal marker text and soft breaks through repeated list conversions', () => {
  for (const text of ['1.', '•', 'Normal']) {
    let source = { ...box, text, textSegments: [{ text, style: {} }] };
    for (const listType of ['numbered', 'bullet', 'none'] as const) {
      source = { ...source, ...formatText(source, { listType }) };
      expect(source.text).toBe(text);
    }
  }
  const source = {
    ...box,
    text: 'One\nTwo',
    textSegments: [
      { text: 'One', style: {} },
      { text: '\n', style: {}, isLineBreak: true as const },
      { text: 'Two', style: {} },
    ],
  };
  for (const listType of ['bullet', 'numbered', 'none'] as const) {
    const changed = formatText(source, { listType });
    expect(changed.text).toBe('One\nTwo');
    expect(changed.textSegments.filter((run) => run.isLineBreak)).toEqual([
      { ...source.textSegments[1], style: { listType } },
    ]);
    expect(changed.textSegments.some((run) => run.isParagraphBreak)).toBe(
      false,
    );
    expect(changed.textSegments.filter((run) => run.bulletInfo)).toHaveLength(
      1,
    );
  }
  const empty = formatText(
    {
      ...box,
      textSegments: [
        {
          text: '1. ',
          style: {},
          paragraphInsertionStyle: { fontSize: 12 },
          paragraphLevel: 1,
          endParaRunProperties: {},
          bulletInfo: { autoNumType: 'arabicPeriod', paragraphIndex: 0 },
        },
      ],
    },
    { listType: 'none', fontSize: 24 },
  );
  expect(empty.text).toBe('');
  expect(empty.textSegments[0]).toMatchObject({
    paragraphInsertionStyle: { fontSize: 24 },
    paragraphLevel: 1,
  });
});

it('updates parsed indentation and clears competing text fills for explicit RGB', () => {
  const source = {
    ...box,
    paragraphIndents: [
      { marginLeft: 40, indent: -12 },
      { marginLeft: 80, indent: -20 },
    ],
    textSegments: [
      { text: 'One', style: {} },
      { text: '\n', style: {} },
      { text: 'Two', style: {} },
    ],
  };
  expect(
    formatText(source, { paragraphMarginLeft: 0 }).paragraphIndents,
  ).toEqual([
    { marginLeft: 0, indent: -12 },
    { marginLeft: 0, indent: -20 },
  ]);
  expect(formatText(source, { paragraphIndent: 0 }).paragraphIndents).toEqual([
    { marginLeft: 40, indent: 0 },
    { marginLeft: 80, indent: 0 },
  ]);
  expect(
    formatText(box, { paragraphIndent: 10, paragraphMarginLeft: 20 })
      .paragraphIndents,
  ).toEqual([{ marginLeft: 20, indent: 10 }]);
  const filled = {
    ...box,
    textStyle: {
      textFillNone: true,
      textFillGradient: 'linear-gradient(red,blue)',
      textFillGradientStops: [{ color: '#ff0000', position: 0 }],
      textFillGradientAngle: 90,
      textFillGradientType: 'linear' as const,
      textFillPattern: 'pct5',
      textFillPatternForeground: '#ff0000',
      textFillPatternBackground: '#00ff00',
    },
  };
  expect(formatText(filled, { color: '#123456' }).textStyle).toEqual({
    color: '#123456',
  });
  expect(filled.textStyle.textFillNone).toBe(true);
});
