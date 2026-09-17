import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';

export interface AttachmentIntent {
  key: string;
  files: readonly FileAttachmentRef[];
}

/** Only typed file blocks in admitted user messages identify chat attachments. */
export function attachmentIntent(
  event: SessionEvent,
): AttachmentIntent | undefined {
  if (event.type !== 'user/message') return undefined;
  const files = event.data.content.flatMap((part) =>
    part.type === 'file' && /\.pptx$/i.test(part.attachment.name)
      ? [part.attachment]
      : [],
  );
  if (!files.length) return undefined;
  return {
    key: `${String(event.seq)}:${files.map((file) => file.attachmentId).join(':')}`,
    files,
  };
}

/** Limit matching to the active turn so a later local open remains usable. */
export function turnAttachment(
  events: readonly SessionEvent[],
): AttachmentIntent | undefined {
  for (const event of events.toReversed()) {
    if (event.type === 'turn/start') break;
    const intent = attachmentIntent(event);
    if (intent) return intent;
  }
  return undefined;
}
