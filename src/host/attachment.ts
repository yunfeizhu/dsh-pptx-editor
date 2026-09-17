import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { attachmentIntent } from '../attachments.js';
import { MAX_FILE_BYTES } from '../protocol.js';

/** Resolve authority from the exact session's admitted file blocks, never from a supplied path/ref. */
export async function readChatAttachment(
  events: readonly SessionEvent[] | undefined,
  attachmentId: string,
  store: Pick<AttachmentStore, 'readFileStream'>,
): Promise<Uint8Array> {
  const ref = events
    ?.flatMap((event) => attachmentIntent(event)?.files ?? [])
    .find((file) => file.attachmentId === attachmentId);
  if (!ref)
    throw new Error('PPTX attachment is not available in this conversation');
  if (ref.bytes > MAX_FILE_BYTES)
    throw new Error('PPTX exceeds the 50 MiB limit');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of store.readFileStream(ref)) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) throw new Error('PPTX exceeds the 50 MiB limit');
    chunks.push(chunk.slice());
  }
  if (size !== ref.bytes)
    throw new Error('PPTX attachment size does not match');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
