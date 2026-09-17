import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BASE_PATH,
  MAX_WIRE_BYTES,
  errorMessage,
  exchangeSchema,
  identitySchema,
  attachmentRequestSchema,
} from '../protocol.js';
import type { EditorBroker } from './broker.js';

export interface HttpOptions {
  port: number;
  assets: URL;
  broker: EditorBroker;
  authorize: (request: IncomingMessage) => number | undefined;
  readAttachment?: (
    sessionId: string,
    attachmentId: string,
  ) => Promise<Uint8Array>;
}

/** Same-origin capability gate for the Web-only editor transport. */
export function createHttpHandler({
  port,
  assets,
  broker,
  authorize,
  readAttachment,
}: HttpOptions) {
  const token = randomBytes(32).toString('hex');
  const allowedHosts = new Set([
    `127.0.0.1:${String(port)}`,
    `localhost:${String(port)}`,
  ]);
  const files = new Map([
    [`${BASE_PATH}/`, ['editor.html', 'text/html; charset=utf-8']],
    [`${BASE_PATH}/editor.js`, ['editor.js', 'text/javascript; charset=utf-8']],
    [`${BASE_PATH}/editor.css`, ['editor.css', 'text/css; charset=utf-8']],
  ]);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'self'; object-src 'none'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const host = req.headers.host ?? '';
    const rejection = authorize(req);
    if (rejection !== undefined) {
      json(rejection, {
        error: 'Sign in to DSH before opening the PPTX editor',
      });
      return;
    }
    const origin = `http://${host}`;
    if (
      !allowedHosts.has(host) ||
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] !== undefined &&
        !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
    ) {
      json(403, { error: 'Same-origin loopback access required' });
      return;
    }
    const path = new URL(req.url ?? '/', origin).pathname;
    if (req.method === 'GET') {
      if (path === `${BASE_PATH}/bootstrap`) {
        json(200, { token });
        return;
      }
      const file = files.get(path);
      if (!file) {
        json(404, { error: 'Not found' });
        return;
      }
      try {
        const content = await readFile(new URL(file[0] ?? '', assets));
        res.writeHead(200, {
          'Content-Type': file[1] ?? 'application/octet-stream',
        });
        res.end(content);
      } catch {
        json(503, { error: 'Editor assets unavailable; run pnpm build' });
      }
      return;
    }
    if (
      req.method !== 'POST' ||
      req.headers['x-pptx-token'] !== token ||
      req.headers.origin !== origin
    ) {
      json(403, { error: 'Editor capability required' });
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string);
        size += bytes.length;
        if (size > MAX_WIRE_BYTES) {
          json(413, { error: 'Request too large' });
          return;
        }
        chunks.push(bytes);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === `${BASE_PATH}/attachment` && readAttachment) {
        const { sessionId, attachmentId } =
          attachmentRequestSchema.parse(input);
        const bytes = await readAttachment(sessionId, attachmentId);
        res.writeHead(200, {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        });
        res.end(bytes);
      } else if (path === `${BASE_PATH}/claim`) {
        const { sessionId, clientId } = identitySchema.parse(input);
        broker.claim(sessionId, clientId);
        json(200, {});
      } else if (path === `${BASE_PATH}/exchange`) {
        const { sessionId, clientId, reply } = exchangeSchema.parse(input);
        json(200, { requests: broker.exchange(sessionId, clientId, reply) });
      } else if (path === `${BASE_PATH}/release`) {
        const { sessionId, clientId } = identitySchema.parse(input);
        broker.release(sessionId, clientId);
        json(200, {});
      } else {
        json(404, { error: 'Not found' });
      }
    } catch (error) {
      json(400, { error: errorMessage(error).slice(0, 1000) });
    }
  };
}
