import type { PowerPointViewerAPI } from 'pptx-react-viewer';
import {
  textStyleSchema,
  shapeStyleSchema,
  type EditInput,
} from './protocol.js';

export type Element = ReturnType<PowerPointViewerAPI['getElements']>[number];
type TextElement = Extract<Element, { type: 'text' | 'shape' | 'connector' }>;
type Style = NonNullable<TextElement['textStyle']>;
type Segment = NonNullable<TextElement['textSegments']>[number];
type TextPatch = NonNullable<EditInput['patch']['textStyle']>;

export function hasText(element: Element): element is TextElement {
  return ['text', 'shape', 'connector'].includes(element.type);
}

function defined<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function mergeStyle(source: Style | undefined, patch: TextPatch): Style {
  const result: Style = { ...source, ...defined(patch) };
  if (patch.color !== undefined) {
    delete result.colorRef;
    delete result.colorXml;
    delete result.textFillNone;
    delete result.textFillGradient;
    delete result.textFillGradientStops;
    delete result.textFillGradientAngle;
    delete result.textFillGradientType;
    delete result.textFillPattern;
    delete result.textFillPatternForeground;
    delete result.textFillPatternBackground;
  }
  if (patch.fontFamily !== undefined) {
    delete result.latinFontThemeToken;
    delete result.eastAsiaFontThemeToken;
    delete result.complexScriptFontThemeToken;
    delete result.scriptFallbackFont;
    result.eastAsiaFont = patch.fontFamily;
    result.complexScriptFont = patch.fontFamily;
  }
  if (patch.underline !== undefined) {
    delete result.underlineStyle;
    result.underlineExplicitNone = !patch.underline;
  }
  if (patch.lineSpacing !== undefined) delete result.lineSpacingExactPt;
  return result;
}

export function plainSegments(text: string, style: Style): Segment[] {
  return text
    .split('\n')
    .flatMap((line, index) => [
      ...(index
        ? [{ text: '', style: { ...style }, isParagraphBreak: true }]
        : []),
      { text: line, style: { ...style } },
    ]);
}

/** Parsed lists contain display-only marker runs; never turn those into content. */
function isDisplayMarker(segment: Segment): boolean {
  const info = segment.bulletInfo;
  if (!info || info.none || segment.fieldType || segment.isLineBreak)
    return false;
  let marker: string | undefined;
  if (info.autoNumType) {
    if (info.autoNumType !== 'arabicPeriod')
      throw new Error(
        'Change custom numbering in the editor before converting this list',
      );
    if (info.paragraphIndex === undefined) return false;
    marker = `${String(Math.max(1, (info.autoNumStartAt ?? 1) + info.paragraphIndex))}.`;
  } else if (info.imageRelId || info.imageDataUrl || info.imageBlipFillXml) {
    marker = '📎';
  } else if (info.char) marker = info.char;
  return (
    marker !== undefined &&
    (segment.text === marker || segment.text === `${marker} `)
  );
}

function normalizedSegments(segments: Segment[]): Segment[] {
  return segments.flatMap((segment) =>
    segment.isParagraphBreak || segment.isLineBreak
      ? [segment]
      : segment.text === '\n'
        ? [{ ...segment, isParagraphBreak: true }]
        : plainSegments(segment.text, segment.style).map((part, index) =>
            index === 0 ? { ...segment, ...part } : part,
          ),
  );
}

function convertLists(
  segments: Segment[],
  kind: NonNullable<TextPatch['listType']>,
) {
  const paragraphs: Segment[][] = [[]];
  const separators: Segment[] = [];
  for (const segment of normalizedSegments(segments)) {
    if (segment.isParagraphBreak) {
      separators.push(segment);
      paragraphs.push([]);
    } else paragraphs[paragraphs.length - 1]?.push(segment);
  }
  let text = '';
  const textSegments = paragraphs.flatMap((paragraph, ordinal) => {
    const source = paragraph[0] ?? { text: '', style: {} };
    const marker =
      isDisplayMarker(source) &&
      (paragraph.length > 1 || source.paragraphInsertionStyle !== undefined);
    const content = (marker ? paragraph.slice(1) : paragraph).map((segment) => {
      const next = { ...segment };
      delete next.bulletInfo;
      return next;
    });
    const body: Segment = { ...source, ...content[0] };
    if (marker && !content.length) body.text = '';
    delete body.bulletInfo;
    // Paragraph metadata may live on the parser's separate marker run.
    for (const key of [
      'paragraphProperties',
      'paragraphLevel',
      'endParaRunProperties',
      'paragraphInsertionStyle',
    ] as const) {
      if (source[key] !== undefined)
        Object.assign(body, { [key]: source[key] });
    }
    const runs = [body, ...content.slice(1)];
    text += `${ordinal ? '\n' : ''}${runs.map((run) => run.text).join('')}`;
    if (kind === 'none') body.bulletInfo = { none: true };
    else {
      const bulletInfo =
        kind === 'bullet'
          ? { char: '•' }
          : {
              autoNumType: 'arabicPeriod',
              autoNumStartAt: 1,
              paragraphIndex: ordinal,
            };
      const prefix: Segment = {
        style: body.style,
        text: kind === 'bullet' ? '• ' : `${String(ordinal + 1)}. `,
        bulletInfo,
      };
      for (const key of [
        'paragraphProperties',
        'paragraphLevel',
        'endParaRunProperties',
        'paragraphInsertionStyle',
      ] as const) {
        if (body[key] !== undefined)
          Object.assign(prefix, { [key]: body[key] });
      }
      delete body.paragraphInsertionStyle;
      runs.unshift(prefix);
    }
    const separator = separators[ordinal];
    return separator ? [...runs, separator] : runs;
  });
  return { textSegments, text };
}

/** Apply only requested formatting; retain run boundaries and paragraph metadata. */
export function formatText(
  element: TextElement,
  patch: TextPatch,
): { textStyle: Style; textSegments: Segment[] } & Pick<
  TextElement,
  'text' | 'paragraphIndents'
> {
  const textStyle = mergeStyle(element.textStyle, patch);
  const textSegments = (
    element.textSegments?.length
      ? element.textSegments
      : plainSegments(element.text ?? '', element.textStyle ?? {})
  ).map((segment) => ({
    ...segment,
    style: mergeStyle(segment.style, patch),
    ...(segment.paragraphInsertionStyle
      ? {
          paragraphInsertionStyle: mergeStyle(
            segment.paragraphInsertionStyle,
            patch,
          ),
        }
      : {}),
    ...(segment.paragraphProperties
      ? {
          paragraphProperties: mergeStyle(segment.paragraphProperties, patch),
        }
      : {}),
  }));
  const indentation =
    patch.paragraphMarginLeft !== undefined ||
    patch.paragraphIndent !== undefined
      ? {
          paragraphIndents: Array.from(
            {
              length:
                normalizedSegments(textSegments).filter(
                  (segment) => segment.isParagraphBreak,
                ).length + 1,
            },
            (_, index) => ({
              ...element.paragraphIndents?.[index],
              ...(patch.paragraphMarginLeft !== undefined
                ? { marginLeft: patch.paragraphMarginLeft }
                : {}),
              ...(patch.paragraphIndent !== undefined
                ? { indent: patch.paragraphIndent }
                : {}),
            }),
          ),
        }
      : {};
  return {
    textStyle,
    textSegments,
    ...indentation,
    ...(patch.listType !== undefined
      ? convertLists(textSegments, patch.listType)
      : {}),
  };
}

export function elementPatch(
  element: Element,
  patch: EditInput['patch'],
): Partial<Element> {
  const { text, textStyle, shapeStyle, ...geometry } = patch;
  const result: Partial<TextElement> = { ...defined(geometry) };
  if (text !== undefined || textStyle) {
    if (!hasText(element)) throw new Error('This element has no editable text');
    const next =
      text === undefined
        ? element
        : {
            ...element,
            text,
            textSegments: plainSegments(
              text,
              element.textSegments?.[0]?.style ?? element.textStyle ?? {},
            ),
          };
    if (text !== undefined) {
      result.text = text;
      result.textSegments = next.textSegments ?? [];
    }
    if (textStyle) Object.assign(result, formatText(next, textStyle));
  }
  if (shapeStyle) {
    if (!['text', 'shape', 'connector'].includes(element.type))
      throw new Error(
        'Fill and outline formatting requires a text box or shape',
      );
    const style = {
      ...(element as TextElement).shapeStyle,
      ...defined(shapeStyle),
    };
    if (
      shapeStyle.fillColor !== undefined ||
      shapeStyle.fillMode !== undefined
    ) {
      style.fillMode = shapeStyle.fillMode ?? 'solid';
      style.useBackgroundFill = false;
      delete style.fillColorRef;
      delete style.fillColorXml;
    }
    if (shapeStyle.strokeColor !== undefined) {
      delete style.strokeColorRef;
      delete style.strokeColorXml;
      style.strokeFillMode = 'solid';
    }
    result.shapeStyle = style;
  }
  return result;
}

function project(value: object | undefined, keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((key) =>
      value && (Reflect.get(value, key) as unknown) !== undefined
        ? [[key, Reflect.get(value, key) as unknown]]
        : [],
    ),
  );
}

export function formatProjection(element: Element) {
  const textKeys = Object.keys(textStyleSchema.shape);
  const paragraphKeys = [
    'align',
    'lineSpacing',
    'paragraphSpacingBefore',
    'paragraphSpacingAfter',
    'paragraphMarginLeft',
    'paragraphMarginRight',
    'paragraphIndent',
  ];
  const paragraphStyle = (segment: Segment | undefined, index: number) => {
    const indent = hasText(element)
      ? element.paragraphIndents?.[index]
      : undefined;
    return {
      ...project(segment?.paragraphProperties, paragraphKeys),
      ...(indent?.marginLeft !== undefined
        ? { paragraphMarginLeft: indent.marginLeft }
        : {}),
      ...(indent?.indent !== undefined
        ? { paragraphIndent: indent.indent }
        : {}),
    };
  };
  let paragraphIndex = 0;
  let paragraphStart = true;
  let paragraphProperties: Record<string, unknown> = {};
  return {
    ...(hasText(element)
      ? {
          // Imported paragraph properties override inherited element/run defaults.
          // The element summary describes the first paragraph; runs retain each one.
          textStyle: {
            ...project(element.textStyle, textKeys),
            ...paragraphStyle(element.textSegments?.[0], 0),
          },
          textRuns: (element.textSegments ?? []).map((segment) => {
            if (paragraphStart) {
              paragraphProperties = paragraphStyle(segment, paragraphIndex);
              paragraphStart = false;
            }
            const paragraphBreak =
              !segment.isLineBreak &&
              (segment.isParagraphBreak === true || segment.text === '\n');
            const run = {
              text: segment.text,
              paragraphBreak,
              style: {
                ...project(segment.style, textKeys),
                ...paragraphProperties,
              },
            };
            if (paragraphBreak) {
              paragraphIndex += 1;
              paragraphStart = true;
            }
            return run;
          }),
          shapeStyle: project(
            element.shapeStyle,
            Object.keys(shapeStyleSchema.shape),
          ),
        }
      : {}),
    rotation: element.rotation ?? 0,
    flipHorizontal: element.flipHorizontal ?? false,
    flipVertical: element.flipVertical ?? false,
  };
}
