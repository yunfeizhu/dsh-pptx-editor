import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { z } from 'zod';
import { BASE_PATH, MAX_FILE_BYTES } from '../protocol.js';
import { openAttachment } from './file.js';

export async function loadChatFile(
  sessionId: string,
  file: FileAttachmentRef,
  signal: AbortSignal,
) {
  if (file.bytes > MAX_FILE_BYTES)
    throw new Error('PPTX exceeds the 50 MiB limit');
  const bootstrap = await fetch(`${BASE_PATH}/bootstrap`, { signal });
  if (!bootstrap.ok) throw new Error('PPTX plugin unavailable');
  const { token } = z
    .object({ token: z.string() })
    .parse(await bootstrap.json());
  const response = await fetch(`${BASE_PATH}/attachment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pptx-Token': token },
    body: JSON.stringify({ sessionId, attachmentId: file.attachmentId }),
    signal,
  });
  if (!response.ok)
    throw new Error('Could not open the PPTX attachment. Retry opening it.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.length !== file.bytes)
    throw new Error('PPTX attachment size does not match');
  return openAttachment(file.name, bytes);
}
