import { expect, it, vi } from 'vitest';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { imageAttachments, readChatImage } from '../src/host/images.js';
import {
  updateImage,
  imageProjection,
  imageStyleSchema,
  MAX_IMAGE_BYTES,
} from '../src/image-editing.js';
import { DocumentSession } from '../src/document-session.js';
import { operationFixture } from './operation-fixture.js';
import { operationSchema, replySchema } from '../src/protocol.js';

const ref = {
  attachmentId: 'image',
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
} as ImageAttachmentRef;
const events = (image = ref) =>
  [
    {
      type: 'user/message',
      seq: 1,
      data: {
        content: [
          { type: 'image', attachment: image },
          { type: 'text', text: 'ignored' },
        ],
      },
    },
  ] as SessionEvent[];
it('uses only admitted user image references and rejects cross-session IDs, size and metadata mismatch', async () => {
  const store = {
    readImage: vi.fn(() =>
      Promise.resolve({ ref, data: new Uint8Array([1, 2, 3]) }),
    ),
  };
  const signal = new AbortController().signal;
  expect(
    imageAttachments([
      ...events(),
      ...events(),
      { type: 'turn/start' } as SessionEvent,
    ]),
  ).toEqual([ref]);
  expect(await readChatImage(events(), 'image', store, signal)).toBe(
    'data:image/png;base64,AQID',
  );
  await expect(readChatImage([], 'image', store, signal)).rejects.toThrow(
    'conversation',
  );
  await expect(
    readChatImage(
      events({ ...ref, bytes: MAX_IMAGE_BYTES + 1 }),
      'image',
      store,
      signal,
    ),
  ).rejects.toThrow('1 MiB');
  store.readImage.mockResolvedValueOnce({ ref, data: new Uint8Array([1]) });
  await expect(readChatImage(events(), 'image', store, signal)).rejects.toThrow(
    'metadata',
  );
  await expect(
    readChatImage(events(), 'image', store, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(store.readImage).toHaveBeenCalledTimes(2);
});
it('inserts one image, rejects replay, crops/adjusts it and restores it through undo', () => {
  const { editor, commit } = operationFixture();
  const file = {
    name: 'synthetic.pptx',
    read: () => Promise.resolve(new Uint8Array([1])),
    write: vi.fn(),
  };
  const session = new DocumentSession(
    file,
    new Uint8Array([1]),
    editor,
    commit,
  );
  const base = () => ({
    documentId: session.id,
    version: session.read().version,
    summary: 'Image',
  });
  const input = {
    ...base(),
    slideIndex: 0,
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    imageData: 'data:image/png;base64,AQID',
    altText: 'Example',
  };
  const receipt = session.addImage(input);
  expect(receipt.status).toBe('applied');
  expect(() => session.addImage(input)).toThrow('Stale');
  const image = editor.getSlides()[0]?.elements.at(-1);
  if (!image) throw new Error('Missing image');
  expect(
    replySchema.safeParse({ ok: true, value: imageProjection(image) }).success,
  ).toBe(true);
  session.operate(
    operationSchema.parse({
      ...base(),
      operation: 'update-image',
      slideIndex: 0,
      elementId: image.id,
      update: {
        cropLeft: 0.1,
        cropRight: 0.2,
        effects: { alphaModFix: 80, contrast: 20 },
      },
    }),
  );
  expect(session.read().slides[0]?.elements.at(-1)).toMatchObject({
    image: {
      altText: 'Example',
      cropLeft: 0.1,
      cropRight: 0.2,
      effects: { alphaModFix: 80, contrast: 20 },
    },
  });
  editor.undo();
  expect(session.read().slides[0]?.elements.at(-1)).toMatchObject({
    image: { cropLeft: 0, effects: { grayscale: false } },
  });
  expect(() =>
    updateImage(
      { ...image, type: 'shape', shapeType: 'rect' },
      { altText: 'x' },
    ),
  ).toThrow('not an image');
  expect(() => updateImage(image, { cropLeft: 0.9, cropRight: 0.2 })).toThrow(
    'nonempty',
  );
  expect(imageStyleSchema.safeParse({}).success).toBe(false);
  expect(
    imageStyleSchema.safeParse({ effects: { grayscale: true } }).success,
  ).toBe(false);
  expect(
    imageProjection({ ...image, type: 'shape', shapeType: 'rect' }),
  ).toEqual({});
  expect(updateImage(image, { altText: 'Changed' })).toEqual({
    altText: 'Changed',
  });
  expect(file.write).not.toHaveBeenCalled();
});
