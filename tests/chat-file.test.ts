import { afterEach, expect, it, vi } from 'vitest';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { loadChatFile } from '../src/editor/chat-file.js';
import { openAttachment } from '../src/editor/file.js';
import { MAX_FILE_BYTES } from '../src/protocol.js';
vi.mock('../src/editor/file.js', () => ({
  openAttachment: vi.fn(() => 'opened'),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const ref = {
  name: 'test.pptx',
  bytes: 2,
  attachmentId: 'file',
} as FileAttachmentRef;

it('uses an authenticated POST bound to the session and validates downloaded bytes before opening', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ token: 'test-capability' }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect(await loadChatFile('s', ref, signal)).toBe('opened');
  expect(fetch.mock.calls[1]?.[1]).toEqual({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pptx-Token': 'test-capability',
    },
    body: JSON.stringify({ sessionId: 's', attachmentId: 'file' }),
    signal,
  });
  expect(openAttachment).toHaveBeenCalledExactlyOnceWith(
    'test.pptx',
    new Uint8Array([1, 2]),
  );
});

it('rejects oversized, unavailable, mismatched and cancelled attachment loads', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  await expect(
    loadChatFile('s', { ...ref, bytes: MAX_FILE_BYTES + 1 }, controller.signal),
  ).rejects.toThrow('50 MiB');
  fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
  await expect(loadChatFile('s', ref, controller.signal)).rejects.toThrow(
    'unavailable',
  );
  fetch
    .mockResolvedValueOnce(Response.json({ token: 't' }))
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  await expect(loadChatFile('s', ref, controller.signal)).rejects.toThrow(
    'Could not open',
  );
  fetch
    .mockResolvedValueOnce(Response.json({ token: 't' }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1])));
  await expect(loadChatFile('s', ref, controller.signal)).rejects.toThrow(
    'size',
  );
  controller.abort();
  fetch
    .mockResolvedValueOnce(Response.json({ token: 't' }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
  await expect(loadChatFile('s', ref, controller.signal)).rejects.toThrow();
  expect(openAttachment).not.toHaveBeenCalled();
});
