import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { MAX_IMAGE_BYTES, imageDataSchema } from '../image-editing.js';

/** Only admitted user images in this exact conversation grant attachment authority. */
export function imageAttachments(events: readonly SessionEvent[]) {
  const refs = events.flatMap((event) =>
    event.type === 'user/message'
      ? event.data.content.flatMap((part) =>
          part.type === 'image' ? [part.attachment] : [],
        )
      : [],
  );
  return [...new Map(refs.map((ref) => [ref.attachmentId, ref])).values()];
}

export async function readChatImage(
  events: readonly SessionEvent[],
  attachmentId: string,
  store: Pick<AttachmentStore, 'readImage'>,
  signal: AbortSignal,
): Promise<string> {
  const ref = imageAttachments(events).find(
    (ref) => ref.attachmentId === attachmentId,
  );
  if (!ref)
    throw new Error('Image attachment is not available in this conversation');
  if (ref.bytes > MAX_IMAGE_BYTES)
    throw new Error(
      'Image insertion currently supports normalized images up to 1 MiB',
    );
  signal.throwIfAborted();
  const image = await store.readImage(ref, signal);
  signal.throwIfAborted();
  if (
    image.data.length !== ref.bytes ||
    image.ref.attachmentId !== ref.attachmentId ||
    image.ref.mediaType !== ref.mediaType
  )
    throw new Error('Image attachment metadata does not match');
  return imageDataSchema.parse(
    `data:${ref.mediaType};base64,${Buffer.from(image.data).toString('base64')}`,
  );
}
