import { afterEach, expect, it, vi } from 'vitest';
import { EditorBroker } from '../src/host/broker.js';

afterEach(() => {
  vi.useRealTimers();
});

it('isolates sessions and only accepts replies from the claiming browser', async () => {
  const broker = new EditorBroker();
  broker.claim('s1', 'c1');
  broker.claim('s2', 'c2');
  broker.claim('s1', 'c1');
  expect(() => {
    broker.claim('s1', 'other');
  }).toThrow('already');
  const request = broker.request(
    's1',
    { kind: 'read' },
    new AbortController().signal,
  );
  expect(broker.exchange('s2', 'c2')).toEqual([]);
  expect(() => broker.exchange('s1', 'c2')).toThrow('disconnected');
  const [command] = broker.exchange('s1', 'c1');
  if (!command) throw new Error('Request missing');
  expect(command.command).toEqual({ kind: 'read' });
  expect(broker.exchange('s1', 'c1')).toEqual([]);
  broker.exchange('s1', 'c1', {
    id: command.id,
    result: { ok: true, value: { text: 'Live editor' } },
  });
  await expect(request).resolves.toEqual({ text: 'Live editor' });
  broker.release('s1', 'not-owner');
  expect(() => broker.exchange('s1', 'c1')).not.toThrow();
  broker.dispose();
});

it('rejects missing editors, concurrent requests, cancellation and late replies', async () => {
  const broker = new EditorBroker();
  await expect(
    broker.request('s', { kind: 'read' }, new AbortController().signal),
  ).rejects.toThrow('Open');
  broker.claim('s', 'c');
  const controller = new AbortController();
  const request = broker.request('s', { kind: 'read' }, controller.signal);
  const rejected = request.catch((error: unknown) => error);
  await expect(
    broker.request('s', { kind: 'read' }, controller.signal),
  ).rejects.toThrow('already');
  const [command] = broker.exchange('s', 'c');
  if (!command) throw new Error('Request missing');
  controller.abort();
  expect(await rejected).toBeInstanceOf(Error);
  expect(
    broker.exchange('s', 'c', {
      id: command.id,
      result: { ok: true, value: 'late' },
    }),
  ).toEqual([]);
  await expect(
    broker.request('s', { kind: 'read' }, controller.signal),
  ).rejects.toThrow();
  broker.dispose();
});

it('settles failures on timeout, disconnect, plugin disposal and lease expiry', async () => {
  vi.useFakeTimers();
  const broker = new EditorBroker(Date.now, 100, 1000);
  for (const cause of ['timeout', 'release', 'dispose', 'expire'] as const) {
    broker.claim('s', 'c');
    const request = broker.request(
      's',
      { kind: 'read' },
      new AbortController().signal,
    );
    const outcome = request.catch((error: unknown) => error);
    if (cause === 'timeout') await vi.advanceTimersByTimeAsync(1000);
    else if (cause === 'release') broker.release('s', 'c');
    else if (cause === 'dispose') broker.dispose();
    else {
      await vi.advanceTimersByTimeAsync(101);
      broker.expire();
    }
    expect(await outcome).toBeInstanceOf(Error);
  }
  broker.dispose();
});

it('bounds the number of browser owners', () => {
  const broker = new EditorBroker();
  for (let i = 0; i < 64; i += 1) broker.claim(String(i), 'client');
  expect(() => {
    broker.claim('overflow', 'client');
  }).toThrow('Too many');
  broker.dispose();
});
