import { createServer, request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorBroker } from '../src/host/broker.js';
import { createHttpHandler } from '../src/host/http.js';
import { MAX_WIRE_BYTES } from '../src/protocol.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function server(
  readAttachment?: Parameters<typeof createHttpHandler>[0]['readAttachment'],
) {
  const dir = await mkdtemp(join(tmpdir(), 'pptx-http-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, 'editor.html'),
    '<!doctype html><title>Synthetic editor</title>',
  );
  const broker = new EditorBroker();
  const http = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const handler = createHttpHandler({
    port: address.port,
    assets: pathToFileURL(`${dir}/`),
    broker,
    authorize: (req) => (req.headers['x-test-unauthorized'] ? 401 : undefined),
    ...(readAttachment ? { readAttachment } : {}),
  });
  http.on('request', (req, res) => {
    void handler(req, res);
  });
  cleanups.push(async () => {
    broker.dispose();
    http.closeAllConnections();
    await new Promise<void>((resolve) => {
      http.close(() => {
        resolve();
      });
    });
  });
  const bootstrap = await fetch(`${origin}/dsh-pptx/bootstrap`);
  const { token } = (await bootstrap.json()) as { token: string };
  const post = (
    path: string,
    input: unknown,
    overrides: Record<string, string> = {},
  ) =>
    fetch(`${origin}/dsh-pptx/${path}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Pptx-Token': token,
        ...overrides,
      },
      body: JSON.stringify(input),
    });
  return { origin, token, post, broker };
}

it('serves attachment bytes only after authentication and strict identifier validation', async () => {
  const readAttachment = vi.fn(() =>
    Promise.resolve(new Uint8Array([1, 2, 3])),
  );
  const { post } = await server(readAttachment);
  const input = { sessionId: 'session', attachmentId: 'synthetic' };
  expect(
    (await post('attachment', input, { 'X-Test-Unauthorized': 'true' })).status,
  ).toBe(401);
  expect(
    (await post('attachment', input, { 'X-Pptx-Token': 'wrong' })).status,
  ).toBe(403);
  expect(
    (await post('attachment', { ...input, path: '/private/file.pptx' })).status,
  ).toBe(400);
  expect(readAttachment).not.toHaveBeenCalled();
  const response = await post('attachment', input);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain(
    'presentationml.presentation',
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(readAttachment).toHaveBeenCalledExactlyOnceWith(
    'session',
    'synthetic',
  );
  readAttachment.mockRejectedValueOnce(new Error('Attachment not admitted'));
  expect((await post('attachment', input)).status).toBe(400);
  const disabled = await server();
  expect((await disabled.post('attachment', input)).status).toBe(404);
});

it('serves only known assets and fences cross-origin, missing-token and rebinding requests', async () => {
  const { origin, post } = await server();
  const page = await fetch(`${origin}/dsh-pptx/`);
  expect(await page.text()).toContain('Synthetic editor');
  expect(page.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'self'",
  );
  expect((await fetch(`${origin}/dsh-pptx/missing`)).status).toBe(404);
  expect((await fetch(`${origin}/dsh-pptx/editor.js`)).status).toBe(503);
  expect(
    (await post('claim', {}, { Origin: 'https://attacker.invalid' })).status,
  ).toBe(403);
  expect((await post('claim', {}, { 'X-Pptx-Token': 'invalid' })).status).toBe(
    403,
  );
  const rebindingStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = request(
        `${origin}/dsh-pptx/bootstrap`,
        { headers: { Host: 'attacker.invalid' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
  expect(rebindingStatus).toBe(403);
  expect(
    (
      await fetch(`${origin}/dsh-pptx/bootstrap`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(`${origin}/dsh-pptx/claim`, { method: 'OPTIONS' })).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${origin}/dsh-pptx/bootstrap`, {
        headers: { 'X-Test-Unauthorized': 'true' },
      })
    ).status,
  ).toBe(401);
});

it('validates commands and exchanges one session-scoped result without disk write authority', async () => {
  const { post, broker } = await server();
  const identity = { sessionId: 's1', clientId: crypto.randomUUID() };
  expect(
    (await post('claim', { ...identity, path: '/not-authorized' })).status,
  ).toBe(400);
  expect((await post('claim', identity)).status).toBe(200);
  const pending = broker.request(
    's1',
    { kind: 'read' },
    new AbortController().signal,
  );
  const response = await post('exchange', identity);
  const { requests } = (await response.json()) as {
    requests: { id: string }[];
  };
  await post('exchange', {
    ...identity,
    reply: {
      id: requests[0]?.id,
      result: { ok: true, value: 'Synthetic live state' },
    },
  });
  await expect(pending).resolves.toBe('Synthetic live state');
  expect((await post('unknown', identity)).status).toBe(404);
  expect((await post('release', identity)).status).toBe(200);
  expect((await post('exchange', identity)).status).toBe(400);
});

it('bounds bodies and rejects malformed JSON', async () => {
  const { origin, token, post } = await server();
  expect((await post('claim', 'x'.repeat(MAX_WIRE_BYTES + 1))).status).toBe(
    413,
  );
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${origin}/dsh-pptx/claim`,
      { method: 'POST', headers: { Origin: origin, 'X-Pptx-Token': token } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end('{');
  });
  expect(status).toBe(400);
});
