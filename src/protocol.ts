import { z } from 'zod';
import { tableCreateSchema, tableUpdateSchema } from './table-editing.js';
import { chartCreateSchema, chartUpdateSchema } from './chart-editing.js';
import { imageDataSchema, imageStyleSchema } from './image-editing.js';

export const BASE_PATH = '/dsh-pptx';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_WIRE_BYTES = 2 * 1024 * 1024;
export const EDITOR_LEASE_MS = 15_000;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const distanceSchema = z.number().min(0).max(10_000);
export const textStyleSchema = z.strictObject({
  fontFamily: z.string().trim().min(1).max(200).optional(),
  fontSize: z.number().positive().max(400).optional().describe('CSS pixels.'),
  color: colorSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  align: z
    .enum(['left', 'center', 'right', 'justify'])
    .optional()
    .describe(
      'Paragraph alignment inside the existing text box. Do not move or shrink the box to center text.',
    ),
  vAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  lineSpacing: z
    .number()
    .min(0.5)
    .max(10)
    .optional()
    .describe('Line-height multiplier; replaces exact point spacing.'),
  paragraphSpacingBefore: distanceSchema.optional(),
  paragraphSpacingAfter: distanceSchema.optional(),
  paragraphMarginLeft: distanceSchema.optional(),
  paragraphMarginRight: distanceSchema.optional(),
  paragraphIndent: z.number().min(-10_000).max(10_000).optional(),
  bodyInsetLeft: distanceSchema.optional(),
  bodyInsetRight: distanceSchema.optional(),
  bodyInsetTop: distanceSchema.optional(),
  bodyInsetBottom: distanceSchema.optional(),
  listType: z
    .enum(['bullet', 'numbered', 'none'])
    .optional()
    .describe(
      'Whole-box list conversion; imported custom numbering requires the editor UI.',
    ),
});
export const shapeStyleSchema = z.strictObject({
  fillColor: colorSchema.optional(),
  fillMode: z.enum(['solid', 'none']).optional(),
  strokeColor: colorSchema.optional(),
  strokeWidth: z.number().min(0).max(100).optional(),
});
const nonempty = (value: object) => Object.keys(value).length > 0;

export const patchSchema = z
  .strictObject({
    text: z.string().max(20_000).optional(),
    x: z.number().min(-10_000).max(10_000).optional(),
    y: z.number().min(-10_000).max(10_000).optional(),
    width: z.number().positive().max(10_000).optional(),
    height: z.number().positive().max(10_000).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    textStyle: textStyleSchema.refine(nonempty, 'Empty text style').optional(),
    shapeStyle: shapeStyleSchema
      .refine(nonempty, 'Empty shape style')
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Empty edit');

const documentChangeSchema = z.strictObject({
  documentId: z.uuid(),
  version: z.number().int().nonnegative(),
  summary: z.string().min(1).max(1000),
});
export const editSchema = documentChangeSchema.extend({
  slideIndex: z.number().int().nonnegative(),
  elementId: z.string().min(1).max(256),
  patch: patchSchema,
});
export type EditInput = z.infer<typeof editSchema>;

export const batchEditSchema = documentChangeSchema.extend({
  edits: z
    .array(editSchema.pick({ slideIndex: true, elementId: true, patch: true }))
    .min(1)
    .max(100)
    .refine(
      (edits) =>
        new Set(
          edits.map((edit) =>
            JSON.stringify([edit.slideIndex, edit.elementId]),
          ),
        ).size === edits.length,
      'Each slide/element target must appear only once',
    ),
});
export type BatchEditInput = z.infer<typeof batchEditSchema>;

export const addSlideSchema = documentChangeSchema.extend({
  afterSlideIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Zero-based index to insert after. Omit to append at the end.'),
});
export type AddSlideInput = z.infer<typeof addSlideSchema>;
export const addTextSchema = documentChangeSchema.extend({
  slideIndex: z.number().int().nonnegative(),
  text: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => value.trim().length > 0, 'Empty text'),
  x: z
    .number()
    .min(-10_000)
    .max(10_000)
    .describe('Left position in CSS pixels.'),
  y: z
    .number()
    .min(-10_000)
    .max(10_000)
    .describe('Top position in CSS pixels.'),
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
  fontSize: z
    .number()
    .positive()
    .max(400)
    .optional()
    .describe('Font size in CSS pixels; defaults to 24.'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe('Text color as #RRGGBB; defaults to #000000.'),
  bold: z.boolean().optional(),
  textStyle: textStyleSchema
    .refine(nonempty, 'Empty text style')
    .optional()
    .describe(
      'Formatting for the new box. Takes precedence over legacy fontSize/color/bold fields.',
    ),
});
export type AddTextInput = z.infer<typeof addTextSchema>;
export const addImageSchema = documentChangeSchema.extend({
  slideIndex: z.number().int().nonnegative(),
  attachmentId: z.string().min(1).max(200),
  x: z.number().min(-10_000).max(10_000),
  y: z.number().min(-10_000).max(10_000),
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
  altText: z.string().max(2000).optional(),
});
export const insertImageSchema = addImageSchema
  .omit({ attachmentId: true })
  .extend({ imageData: imageDataSchema });
export type InsertImageInput = z.infer<typeof insertImageSchema>;
const slideIndexSchema = z.number().int().nonnegative();
const elementIdsSchema = z
  .array(z.string().min(1).max(256))
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate element IDs');
export const operationSchema = z.discriminatedUnion('operation', [
  documentChangeSchema.extend({
    operation: z.literal('update-image'),
    slideIndex: slideIndexSchema,
    elementId: z.string().min(1).max(256),
    update: imageStyleSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('add-chart'),
    slideIndex: slideIndexSchema,
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    width: z.number().positive().max(10_000),
    height: z.number().positive().max(10_000),
    chart: chartCreateSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('update-chart'),
    slideIndex: slideIndexSchema,
    elementId: z.string().min(1).max(256),
    update: chartUpdateSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('add-table'),
    slideIndex: slideIndexSchema,
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    width: z.number().positive().max(10_000),
    height: z.number().positive().max(10_000),
    table: tableCreateSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('update-table'),
    slideIndex: slideIndexSchema,
    elementId: z.string().min(1).max(256),
    update: tableUpdateSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('navigate'),
    slideIndex: slideIndexSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('delete-slide'),
    slideIndex: slideIndexSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('duplicate-slide'),
    slideIndex: slideIndexSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('move-slide'),
    slideIndex: slideIndexSchema,
    toIndex: slideIndexSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('set-slide-hidden'),
    slideIndex: slideIndexSchema,
    hidden: z.boolean(),
  }),
  documentChangeSchema.extend({ operation: z.literal('undo') }),
  documentChangeSchema.extend({ operation: z.literal('redo') }),
  documentChangeSchema.extend({
    operation: z.literal('delete-elements'),
    slideIndex: slideIndexSchema,
    elementIds: elementIdsSchema,
  }),
  documentChangeSchema.extend({
    operation: z.literal('duplicate-element'),
    slideIndex: slideIndexSchema,
    elementId: z.string().min(1).max(256),
    offsetX: z.number().min(-10_000).max(10_000).default(16),
    offsetY: z.number().min(-10_000).max(10_000).default(16),
  }),
  documentChangeSchema.extend({
    operation: z.literal('arrange-elements'),
    slideIndex: slideIndexSchema,
    elementIds: elementIdsSchema,
    arrangement: z.enum([
      'left',
      'center',
      'right',
      'top',
      'middle',
      'bottom',
      'distribute-horizontal',
      'distribute-vertical',
    ]),
  }),
  documentChangeSchema.extend({
    operation: z.literal('add-shape'),
    slideIndex: slideIndexSchema,
    shape: z.enum([
      'rect',
      'roundRect',
      'ellipse',
      'triangle',
      'diamond',
      'hexagon',
      'chevron',
      'rightArrow',
    ]),
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    width: z.number().positive().max(10_000),
    height: z.number().positive().max(10_000),
    text: z.string().max(20_000).optional(),
    textStyle: textStyleSchema.optional(),
    shapeStyle: shapeStyleSchema.optional(),
  }),
]);
export type OperationInput = z.infer<typeof operationSchema>;
export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('edit-batch'),
    change: batchEditSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal('add-image'),
    change: insertImageSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal('read'),
    attachmentKey: z.string().max(1000).optional(),
    requireVisible: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('edit'),
    edit: editSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal('add-slide'),
    change: addSlideSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal('add-text'),
    change: addTextSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
  z.strictObject({
    kind: z.literal('operate'),
    change: operationSchema,
    attachmentKey: z.string().max(1000).optional(),
  }),
]);
export type EditorCommand = z.infer<typeof commandSchema>;
export const requestSchema = z.strictObject({
  id: z.uuid(),
  command: commandSchema,
});
export type EditorRequest = z.infer<typeof requestSchema>;
export const replySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.json() }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(1000) }),
]);
export type EditorReply = z.infer<typeof replySchema>;
export const identitySchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  clientId: z.uuid(),
});
export const exchangeSchema = identitySchema.extend({
  reply: z.strictObject({ id: z.uuid(), result: replySchema }).optional(),
});
export const attachmentRequestSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  attachmentId: z.string().min(1).max(200),
});

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
