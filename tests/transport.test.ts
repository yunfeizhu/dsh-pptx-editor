import { afterEach, expect, it, vi } from 'vitest';
import { connectEditor } from '../src/editor/transport.js';
import { errorMessage, MAX_WIRE_BYTES, editSchema } from '../src/protocol.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

it.each([
  'success',
  'error',
  'non-error',
  'oversized',
  'async-success',
  'async-error',
] as const)('exchanges a validated command and cleans up: %s', async (kind) => {
  const controller = new AbortController();
  const id = crypto.randomUUID();
  let exchanges = 0;
  let reply: unknown;
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/bootstrap'))
      return Promise.resolve(json({ token: 'test-token' }));
    if (url.endsWith('/exchange')) {
      exchanges += 1;
      if (exchanges === 1)
        return Promise.resolve(
          json({ requests: [{ id, command: { kind: 'read' } }] }),
        );
      if (typeof init?.body !== 'string') throw new Error('Body missing');
      reply = JSON.parse(init.body) as unknown;
      controller.abort();
      return Promise.resolve(json({ requests: [] }));
    }
    if (url.endsWith('/release') && kind === 'error')
      return Promise.reject(new Error('Network unavailable'));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetcher);
  const connected = vi.fn();
  await connectEditor(
    'test-session',
    () => {
      if (kind === 'async-success')
        return Promise.resolve({ status: 'applied' });
      if (kind === 'async-error')
        return Promise.reject(new Error('Batch rejected'));
      if (kind === 'error') throw new Error('Finish inline editing');
      // Deliberately simulate third-party code throwing a non-Error value.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (kind === 'non-error') throw 'bad';
      if (kind === 'oversized') return 'x'.repeat(MAX_WIRE_BYTES);
      return { title: 'Synthetic' };
    },
    controller.signal,
    connected,
  );
  expect(connected).toHaveBeenCalledOnce();
  expect(reply).toMatchObject({
    reply: {
      id,
      result: { ok: kind === 'success' || kind === 'async-success' },
    },
  });
  expect(fetcher).toHaveBeenLastCalledWith(
    '/dsh-pptx/release',
    expect.objectContaining({ keepalive: true }),
  );
});

it('waits between empty exchanges and wakes immediately on disposal', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let exchanges = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/bootstrap'))
        return Promise.resolve(json({ token: 'test' }));
      if (url.endsWith('/exchange')) {
        exchanges += 1;
        return Promise.resolve(json({ requests: [] }));
      }
      return Promise.resolve(json({}));
    }),
  );
  const running = connectEditor(
    's',
    () => null,
    controller.signal,
    () => {},
  );
  await vi.advanceTimersByTimeAsync(1600);
  expect(exchanges).toBe(3);
  controller.abort();
  await running;
});

it('reports bootstrap, claim and protocol errors without executing a command', async () => {
  const execute = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
  await expect(
    connectEditor('s', execute, new AbortController().signal, () => {}),
  ).rejects.toThrow('unavailable');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({ error: 'Already open' }, 400))
      .mockResolvedValue(json({})),
  );
  await expect(
    connectEditor('s', execute, new AbortController().signal, () => {}),
  ).rejects.toThrow('Already open');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ requests: [{ kind: 'unsafe' }] }))
      .mockResolvedValue(json({})),
  );
  await expect(
    connectEditor('s', execute, new AbortController().signal, () => {}),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(errorMessage('unknown')).toBe('Unexpected error');
  expect(editSchema.safeParse({}).success).toBe(false);
});

it('finishes an in-flight claim before releasing when the panel closes', async () => {
  const controller = new AbortController();
  const claim = Promise.withResolvers<Response>();
  const order: string[] = [];
  const connected = vi.fn();
  let claimSignal: AbortSignal | null | undefined;
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/bootstrap'))
      return Promise.resolve(json({ token: 'test' }));
    if (url.endsWith('/claim')) {
      order.push('claim');
      claimSignal = init?.signal;
      return claim.promise;
    }
    order.push('release');
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetcher);
  const running = connectEditor('s', () => null, controller.signal, connected);
  await vi.waitFor(() => {
    expect(order).toEqual(['claim']);
  });
  expect(claimSignal).not.toBe(controller.signal);
  controller.abort();
  expect(order).toEqual(['claim']);
  claim.resolve(json({}));
  await expect(running).rejects.toThrow();
  expect(order).toEqual(['claim', 'release']);
  expect(connected).not.toHaveBeenCalled();
});

it('does not execute a delivered command after the panel has closed', async () => {
  const controller = new AbortController();
  const execute = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/bootstrap'))
        return Promise.resolve(json({ token: 'test' }));
      if (url.endsWith('/exchange')) {
        controller.abort();
        return Promise.resolve(
          json({
            requests: [{ id: crypto.randomUUID(), command: { kind: 'read' } }],
          }),
        );
      }
      return Promise.resolve(json({}));
    }),
  );
  await expect(
    connectEditor('s', execute, controller.signal, () => {}),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it('waits for an abandoned lease without stealing another editor and cancels pending retries', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let claims = 0;
  const connected = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/bootstrap'))
        return Promise.resolve(json({ token: 't' }));
      if (url.endsWith('/claim')) {
        claims += 1;
        return Promise.resolve(
          claims <= 2
            ? json({ error: 'This session already has an editor open' }, 400)
            : json({}),
        );
      }
      if (url.endsWith('/exchange')) {
        controller.abort();
        return Promise.resolve(json({ requests: [] }));
      }
      return Promise.resolve(json({}));
    }),
  );
  const running = connectEditor('s', () => null, controller.signal, connected);
  await vi.advanceTimersByTimeAsync(1000);
  await running;
  expect(claims).toBe(3);
  expect(connected).toHaveBeenCalledOnce();
});

it.each(['cancel', 'timeout'] as const)(
  'bounds ownership conflict retries: %s',
  async (mode) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const connected = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/bootstrap')
            ? json({ token: 't' })
            : url.endsWith('/claim')
              ? json({ error: 'This session already has an editor open' }, 400)
              : json({}),
        ),
      ),
    );
    const running = (async () => {
      await expect(
        connectEditor('s', () => null, controller.signal, connected),
      ).rejects.toThrow();
    })();
    await vi.advanceTimersByTimeAsync(mode === 'timeout' ? 20_000 : 500);
    if (mode === 'cancel') controller.abort();
    await running;
    expect(connected).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('queues a keepalive release on pagehide and removes the unload listener', async () => {
  const page = new EventTarget();
  vi.stubGlobal('window', page);
  const remove = vi.spyOn(page, 'removeEventListener');
  const fetcher = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith('/bootstrap') ? json({ token: 't' }) : json({}),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  await connectEditor(
    's',
    () => null,
    new AbortController().signal,
    () => {
      page.dispatchEvent(new Event('pagehide'));
    },
  );
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith('/release')),
  ).toHaveLength(2);
  expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
  vi.restoreAllMocks();
});
