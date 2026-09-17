import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { attachmentIntent, type AttachmentIntent } from './attachments.js';

export interface AttachmentWatchState {
  seen: Map<string, string>;
  reopened: Map<string, number>;
}

/** Observe the public, admitted Session event feed; draft upload internals stay with DSH. */
export function watchChatAttachments(
  sessions: ISessions,
  open: (
    sessionId: string,
    intent: AttachmentIntent,
    source: 'restore' | 'new',
  ) => void,
  reopen: (sessionId: string, requestId: string) => void,
  state: AttachmentWatchState = { seen: new Map(), reopened: new Map() },
): () => void {
  const { seen, reopened } = state;
  let release: (() => void) | undefined;
  let current: string | undefined;
  const select = () => {
    const id = sessions.list.getSnapshot().current;
    if (id === current && release) return;
    release?.();
    release = undefined;
    current = id;
    if (!id) return;
    const binding = sessions.binding(id);
    if (!binding) return;
    const update = (initial = false) => {
      const window = binding.eventSource.getSnapshot();
      // A live tool invocation is a navigation request, not a replayable document edit.
      if (!initial && window.change.kind === 'append') {
        for (const entry of window.change.entries) {
          if (
            entry.type === 'event' &&
            entry.event.type === 'tool/call' &&
            entry.event.data.name === 'open_pptx' &&
            entry.event.seq > (reopened.get(id) ?? -1)
          ) {
            reopened.set(id, entry.event.seq);
            reopen(id, entry.event.data.callId);
          }
        }
      }
      // Restore the latest loaded attachment once, then follow only newer messages.
      // Older-history pagination must never replace an open presentation.
      if (window.change.kind === 'prepend') return;
      const entries = !seen.has(id)
        ? window.entries
        : window.change.kind === 'append'
          ? window.change.entries
          : [];
      for (const entry of entries.toReversed()) {
        if (entry.type !== 'event') continue;
        const intent = attachmentIntent(entry.event);
        if (!intent) continue;
        if (seen.get(id) !== intent.key) {
          seen.set(id, intent.key);
          open(
            id,
            intent,
            initial || window.change.kind !== 'append' ? 'restore' : 'new',
          );
        }
        break;
      }
    };
    release = binding.eventSource.subscribe(update);
    update(true);
  };
  const stop = sessions.list.subscribe(select);
  select();
  return () => {
    stop();
    release?.();
  };
}
