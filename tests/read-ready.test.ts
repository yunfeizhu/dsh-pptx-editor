import { afterEach, expect, it, vi } from 'vitest';
import { readReady } from '../src/host/read-ready.js';
afterEach(() => {
  vi.useRealTimers();
});

it('waits for native opening and parsing, but never retries edit or unrelated failures', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValueOnce(
      new Error('Open the PPTX editor tab in this DSH session first'),
    )
    .mockRejectedValueOnce(
      new Error('Open a PPTX file and wait for it to load'),
    )
    .mockRejectedValueOnce(
      new Error('The presentation is loading; retry when it is ready'),
    )
    .mockResolvedValue({ documentId: 'ready' });
  const controller = new AbortController();
  const read = readReady({ request }, 's', 'key', controller.signal);
  await vi.advanceTimersByTimeAsync(750);
  expect(await read).toEqual({ documentId: 'ready' });
  expect(request).toHaveBeenLastCalledWith(
    's',
    { kind: 'read', attachmentKey: 'key' },
    controller.signal,
  );
  request.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(
    readReady({ request }, 's', 'key', controller.signal),
  ).rejects.toThrow('Permission');
});

it('bounds waiting and cancels without leaving timers', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockRejectedValue(new Error('Open a PPTX file and wait for it to load'));
  const controller = new AbortController();
  const timed = (async () => {
    await expect(
      readReady({ request }, 's', 'key', controller.signal, 500),
    ).rejects.toThrow('wait for');
  })();
  await vi.advanceTimersByTimeAsync(500);
  await timed;
  const cancelled = (async () => {
    await expect(
      readReady({ request }, 's', 'key', controller.signal),
    ).rejects.toThrow();
  })();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await cancelled;
  expect(vi.getTimerCount()).toBe(0);
  const aborted = new AbortController();
  request.mockImplementationOnce(async () => {
    await Promise.resolve();
    aborted.abort();
    throw new Error('Open a PPTX file and wait for it to load');
  });
  await expect(
    readReady({ request }, 's', 'key', aborted.signal),
  ).rejects.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});
