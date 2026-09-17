import type { EditorBroker } from './broker.js';
import { errorMessage } from '../protocol.js';

const loadingErrors = new Set([
  'Open the PPTX editor tab in this DSH session first',
  'Open a PPTX file and wait for it to load',
  'The presentation is loading; retry when it is ready',
  'File selection in progress; retry after it finishes',
  'The chat attachment is not loaded yet. Wait for the PPTX editor, then read again.',
  'PPTX panel is not visible yet',
  'PPTX panel is closed',
  'Editor disconnected',
]);

/** Give native navigation, download and parsing time to finish before the first Agent read. */
export async function readReady(
  broker: Pick<EditorBroker, 'request'>,
  sessionId: string,
  attachmentKey: string | undefined,
  signal: AbortSignal,
  timeoutMs = 30_000,
  requireVisible = false,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    try {
      return await broker.request(
        sessionId,
        {
          kind: 'read',
          ...(attachmentKey ? { attachmentKey } : {}),
          ...(requireVisible ? { requireVisible: true } : {}),
        },
        signal,
      );
    } catch (error) {
      if (!loadingErrors.has(errorMessage(error)) || Date.now() >= deadline)
        throw error;
    }
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, 250);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }
}
