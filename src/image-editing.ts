import { z } from 'zod';
import type { Element } from './element-format.js';

export const MAX_IMAGE_BYTES = 1024 * 1024;
export const imageDataSchema = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64)
  .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/);
export const imageStyleSchema = z
  .strictObject({
    altText: z.string().max(2000).optional(),
    cropLeft: z.number().min(0).max(0.99).optional(),
    cropRight: z.number().min(0).max(0.99).optional(),
    cropTop: z.number().min(0).max(0.99).optional(),
    cropBottom: z.number().min(0).max(0.99).optional(),
    cropShape: z
      .enum([
        'none',
        'ellipse',
        'roundedRect',
        'triangle',
        'diamond',
        'pentagon',
        'hexagon',
        'star',
      ])
      .optional(),
    effects: z
      .strictObject({
        brightness: z.number().min(-100).max(100).optional(),
        contrast: z.number().min(-100).max(100).optional(),
        alphaModFix: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Opacity percentage; 100 is opaque.'),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Empty image edit');

export function updateImage(
  element: Element,
  input: z.infer<typeof imageStyleSchema>,
): Partial<Element> {
  if (element.type !== 'image' && element.type !== 'picture')
    throw new Error('Target is not an image');
  const { effects, ...properties } = input;
  const patch = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
  const next = { ...element, ...patch };
  if (
    (next.cropLeft ?? 0) + (next.cropRight ?? 0) >= 1 ||
    (next.cropTop ?? 0) + (next.cropBottom ?? 0) >= 1
  )
    throw new Error('Image crop must retain a nonempty area');
  return {
    ...patch,
    ...(effects
      ? {
          imageEffects: {
            ...element.imageEffects,
            ...Object.fromEntries(
              Object.entries(effects).filter(
                ([, value]) => value !== undefined,
              ),
            ),
          },
        }
      : {}),
  };
}

export function imageProjection(element: Element) {
  if (element.type !== 'image' && element.type !== 'picture') return {};
  return {
    image: {
      altText: element.altText ?? '',
      cropLeft: element.cropLeft ?? 0,
      cropRight: element.cropRight ?? 0,
      cropTop: element.cropTop ?? 0,
      cropBottom: element.cropBottom ?? 0,
      cropShape: element.cropShape ?? 'none',
      effects: {
        brightness: element.imageEffects?.brightness ?? 0,
        contrast: element.imageEffects?.contrast ?? 0,
        grayscale: element.imageEffects?.grayscale ?? false,
        alphaModFix: element.imageEffects?.alphaModFix ?? 100,
      },
    },
  };
}
