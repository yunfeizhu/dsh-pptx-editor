import { z } from 'zod';
import {
  BASE_PATH,
  MAX_WIRE_BYTES,
  errorMessage,
  requestSchema,
  EDITOR_LEASE_MS,
  type EditorCommand,
  type EditorReply,
} from '../protocol.js';

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Keeps all requests bound to the one panel occurrence that claimed the session. */
export async function connectEditor(
  sessionId: string,
  execute: (command: EditorCommand) => unknown,
  signal: AbortSignal,
  onConnected: () => void,
): Promise<void> {
  const response = await fetch(`${BASE_PATH}/bootstrap`, { signal });
  if (!response.ok) throw new Error('PPTX plugin unavailable');
  const { token } = z
    .object({ token: z.string() })
    .parse(await response.json());
  const identity = { sessionId, clientId: crypto.randomUUID() };
  const headers = { 'Content-Type': 'application/json', 'X-Pptx-Token': token };
  const leaving = new AbortController();
  const active = AbortSignal.any([signal, leaving.signal]);
  const page = typeof window === 'undefined' ? undefined : window;
  const release = () =>
    fetch(`${BASE_PATH}/release`, {
      method: 'POST',
      headers,
      body: JSON.stringify(identity),
      keepalive: true,
      signal: AbortSignal.timeout(2000),
    }).catch(() => undefined);
  const onPageHide = () => {
    leaving.abort();
    // Unload may end JavaScript before finally runs; queue the keepalive now.
    void release();
  };
  page?.addEventListener('pagehide', onPageHide);
  const post = async (path: string, body: unknown, requestSignal = active) => {
    const result = await fetch(`${BASE_PATH}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: requestSignal,
    });
    const value: unknown = await result.json();
    if (!result.ok)
      throw new Error(z.object({ error: z.string() }).parse(value).error);
    return value;
  };
  try {
    active.throwIfAborted();
    // A claim may reach the host even if its response is cancelled. Finish it before release.
    const deadline = Date.now() + EDITOR_LEASE_MS + 5000;
    for (;;) {
      active.throwIfAborted();
      try {
        await post('claim', identity, AbortSignal.timeout(5000));
        break;
      } catch (reason) {
        if (
          errorMessage(reason) !== 'This session already has an editor open' ||
          Date.now() >= deadline
        )
          throw reason;
        // A refreshed page can arrive before the abandoned lease expires. Never steal a live owner.
        await pause(500, active);
      }
    }
    active.throwIfAborted();
    onConnected();
    let reply: { id: string; result: EditorReply } | undefined;
    while (!active.aborted) {
      const value = await post('exchange', {
        ...identity,
        ...(reply ? { reply } : {}),
      });
      reply = undefined;
      const { requests } = z
        .object({ requests: z.array(requestSchema).max(1) })
        .parse(value);
      for (const request of requests) {
        active.throwIfAborted();
        try {
          const result = z.json().parse(await execute(request.command));
          if (JSON.stringify(result).length > MAX_WIRE_BYTES / 4)
            throw new Error('Document context is too large');
          reply = { id: request.id, result: { ok: true, value: result } };
        } catch (error) {
          reply = {
            id: request.id,
            result: { ok: false, error: errorMessage(error).slice(0, 1000) },
          };
        }
      }
      if (!reply) await pause(750, active);
    }
  } finally {
    page?.removeEventListener('pagehide', onPageHide);
    await release();
  }
}
