import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { afterEach, expect, it, vi } from 'vitest';
import { apply } from '../src/index.js';
import { EditorBroker } from '../src/host/broker.js';
import { Readable } from 'node:stream';

const toolArgs = (name: string, args: object) =>
  name === 'operate_pptx' ? { action: args } : args;

it('resolves image insertion from admitted conversation images without accepting file paths', async () => {
  const definitions = new Map<string, ToolDefinition>();
  const image = {
    attachmentId: 'synthetic-image',
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  };
  let content: object[] = [{ type: 'image', attachment: image }];
  const readImage = vi.fn(() =>
    Promise.resolve({ ref: image, data: new Uint8Array([1, 2, 3]) }),
  );
  apply({
    webServer: { host: '127.0.0.1' },
    effect: () => {},
    attachments: { readImage },
    tools: {
      register: (tool: ToolDefinition) => definitions.set(tool.name, tool),
    },
  } as unknown as Context);
  const request = vi
    .spyOn(EditorBroker.prototype, 'request')
    .mockResolvedValue({ status: 'applied' });
  const exec = {
    agent: {
      id: 'session',
      session: {
        snapshotEvents: () => [
          { type: 'user/message', seq: 1, data: { content } },
        ],
      },
    },
    signal: new AbortController().signal,
  } as unknown as Parameters<ToolDefinition['execute']>[1];
  const list = definitions.get('list_pptx_images');
  const add = definitions.get('add_pptx_image');
  if (!list || !add) throw new Error('Missing image tools');
  expect(await list.execute({}, exec)).toMatchObject({
    images: [{ attachmentId: 'synthetic-image', name: '' }],
    truncated: false,
  });
  const args = {
    documentId: crypto.randomUUID(),
    version: 0,
    summary: 'Insert',
    slideIndex: 0,
    attachmentId: image.attachmentId,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };
  await add.execute(args, exec);
  expect(request).toHaveBeenCalledWith(
    'session',
    expect.objectContaining({
      kind: 'add-image',
      change: expect.objectContaining({
        imageData: 'data:image/png;base64,AQID',
      }) as unknown,
    }),
    exec.signal,
  );
  expect(() =>
    add.execute({ ...args, path: '/not/authority' }, exec),
  ).toThrow();
  await expect(
    add.execute({ ...args, attachmentId: 'foreign' }, exec),
  ).rejects.toThrow('conversation');
  const noAgent = { signal: exec.signal } as typeof exec;
  expect(() => list.execute({}, noAgent)).toThrow('conversation');
  expect(() => add.execute(args, noAgent)).toThrow('conversation');
  content.push({
    type: 'file',
    attachment: { attachmentId: 'p', name: 'test.pptx', bytes: 1 },
  });
  await add.execute(args, exec);
  expect(request).toHaveBeenLastCalledWith(
    'session',
    expect.objectContaining({ attachmentKey: '1:p' }),
    exec.signal,
  );
  content.push({
    type: 'file',
    attachment: { attachmentId: 'q', name: 'other.pptx', bytes: 1 },
  });
  expect(() => add.execute(args, exec)).toThrow('one PPTX');
  content = Array.from({ length: 51 }, (_, index) => ({
    type: 'image',
    attachment: { ...image, attachmentId: String(index), name: 'Picture' },
  }));
  expect(await list.execute({}, exec)).toMatchObject({ truncated: true });
  request.mockRestore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('routes current-turn attachments to the matching live editor and reads only admitted bytes', async () => {
  const request = vi
    .spyOn(EditorBroker.prototype, 'request')
    .mockResolvedValue({ preview: { status: 'ready' } });
  const definitions = new Map<string, ToolDefinition>();
  const disposers: (() => void)[] = [];
  let route: WebRoute | undefined;
  let files = [{ attachmentId: 'synthetic', name: 'sample.pptx', bytes: 3 }];
  const agent = {
    id: 'session',
    session: {
      snapshotEvents: () => [
        {
          type: 'user/message',
          seq: 1,
          data: {
            content: files.map((attachment) => ({ type: 'file', attachment })),
          },
        },
      ],
    },
  };
  const getAgent = vi.fn<() => typeof agent | undefined>(() => agent);
  const readSession = vi.fn(() =>
    Promise.resolve({
      events: agent.session.snapshotEvents(),
    }),
  );
  const ctx = {
    agents: { get: getAgent },
    sessionQuery: { readSession },
    attachments: {
      readFileStream: async function* () {
        yield await Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    },
    webServer: {
      host: '127.0.0.1',
      port: 1234,
      register: (value: WebRoute) => {
        route = value;
        return () => {};
      },
    },
    connection: { requestRejection: () => undefined },
    tools: {
      register: (definition: ToolDefinition) => {
        definitions.set(definition.name, definition);
      },
    },
    effect: (start: () => () => void) => {
      disposers.push(start());
    },
  };
  apply(ctx as unknown as Context);
  const read = definitions.get('read_pptx');
  const edit = definitions.get('edit_pptx');
  const open = definitions.get('open_pptx');
  if (!read || !edit || !open || !route)
    throw new Error('Registration missing');
  const signal = new AbortController().signal;
  const exec = { signal, agent } as unknown as Parameters<
    ToolDefinition['execute']
  >[1];
  await read.execute({}, exec);
  expect(request).toHaveBeenLastCalledWith(
    'session',
    { kind: 'read', attachmentKey: '1:synthetic' },
    signal,
  );
  const input = {
    documentId: crypto.randomUUID(),
    version: 0,
    slideIndex: 0,
    elementId: 'title',
    summary: 'Synthetic edit',
    patch: { text: 'New title' },
  };
  await edit.execute(input, exec);
  expect(request).toHaveBeenLastCalledWith(
    'session',
    { kind: 'edit', attachmentKey: '1:synthetic', edit: input },
    signal,
  );
  const beforeWrappedEdit = request.mock.calls.length;
  expect(() => edit.execute({ action: input }, exec)).toThrow();
  expect(request).toHaveBeenCalledTimes(beforeWrappedEdit);
  const insertions = [
    [
      'edit_pptx_batch',
      'edit-batch',
      {
        documentId: input.documentId,
        version: 0,
        summary: 'Batch',
        edits: [{ slideIndex: 0, elementId: 'e', patch: { x: 30 } }],
      },
    ],
    [
      'operate_pptx',
      'operate',
      {
        documentId: input.documentId,
        version: 0,
        summary: 'Navigate',
        operation: 'navigate',
        slideIndex: 0,
      },
    ],
    [
      'add_pptx_slide',
      'add-slide',
      {
        documentId: input.documentId,
        version: 0,
        summary: 'Insert slide',
        afterSlideIndex: 0,
      },
    ],
    [
      'add_pptx_text',
      'add-text',
      {
        documentId: input.documentId,
        version: 1,
        summary: 'Insert text',
        slideIndex: 1,
        text: 'New title',
        x: 40,
        y: 50,
        width: 400,
        height: 80,
      },
    ],
  ] as const;
  for (const [name, kind, change] of insertions) {
    const tool = definitions.get(name);
    if (!tool) throw new Error('Missing insertion tool');
    await tool.execute(toolArgs(name, change), exec);
    expect(request).toHaveBeenLastCalledWith(
      'session',
      { kind, change, attachmentKey: '1:synthetic' },
      signal,
    );
    const count = request.mock.calls.length;
    expect(() =>
      tool.execute(toolArgs(name, { ...change, documentId: 'invalid' }), exec),
    ).toThrow();
    expect(request).toHaveBeenCalledTimes(count);
    const wrongShape = name === 'operate_pptx' ? change : { action: change };
    expect(() => tool.execute(wrongShape, exec)).toThrow();
    expect(request).toHaveBeenCalledTimes(count);
  }

  const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
  const headers = {
    host: '127.0.0.1:1234',
    origin: 'http://127.0.0.1:1234',
    'content-type': 'application/json',
  };
  await route.handler(
    { method: 'GET', url: '/dsh-pptx/bootstrap', headers } as Parameters<
      WebRoute['handler']
    >[0],
    res as unknown as Parameters<WebRoute['handler']>[1],
  );
  const { token } = JSON.parse(String(res.end.mock.calls[0]?.[0])) as {
    token: string;
  };
  const req = Object.assign(
    Readable.from([
      Buffer.from(
        JSON.stringify({ sessionId: 'session', attachmentId: 'synthetic' }),
      ),
    ]),
    {
      method: 'POST',
      url: '/dsh-pptx/attachment',
      headers: { ...headers, 'x-pptx-token': token },
    },
  );
  await route.handler(
    req as unknown as Parameters<WebRoute['handler']>[0],
    res as unknown as Parameters<WebRoute['handler']>[1],
  );
  expect(getAgent).toHaveBeenCalledExactlyOnceWith('session');
  expect(res.end).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]));
  expect(readSession).not.toHaveBeenCalled();
  getAgent.mockReturnValue(undefined);
  const attachmentRoute = route;
  const download = async () => {
    const cold = Object.assign(
      Readable.from([
        Buffer.from(
          JSON.stringify({ sessionId: 'session', attachmentId: 'synthetic' }),
        ),
      ]),
      {
        method: 'POST',
        url: '/dsh-pptx/attachment',
        headers: { ...headers, 'x-pptx-token': token },
      },
    );
    await attachmentRoute.handler(
      cold as unknown as Parameters<WebRoute['handler']>[0],
      res as unknown as Parameters<WebRoute['handler']>[1],
    );
  };
  await download();
  expect(readSession).toHaveBeenCalledExactlyOnceWith('session');
  expect(res.end).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]));
  readSession.mockRejectedValueOnce(
    new Error('Private storage path unavailable'),
  );
  await download();
  expect(res.end).toHaveBeenLastCalledWith(
    expect.stringContaining('not available in this conversation'),
  );
  expect(String(res.end.mock.lastCall?.[0])).not.toContain(
    'Private storage path',
  );
  await open.execute({}, exec);
  expect(request).toHaveBeenLastCalledWith(
    'session',
    { kind: 'read', attachmentKey: '1:synthetic', requireVisible: true },
    signal,
  );
  const callsBeforeRejected = request.mock.calls.length;
  files = [...files, { attachmentId: 'second', name: 'second.pptx', bytes: 3 }];
  expect(() => read.execute({}, exec)).toThrow('one PPTX');
  expect(() => edit.execute(input, exec)).toThrow('one PPTX');
  expect(() => open.execute({}, exec)).toThrow('one PPTX');
  for (const [name, , change] of insertions)
    expect(() =>
      definitions.get(name)?.execute(toolArgs(name, change), exec),
    ).toThrow('one PPTX');
  expect(request).toHaveBeenCalledTimes(callsBeforeRejected);
  files = [];
  for (const [name, kind, change] of insertions) {
    await definitions.get(name)?.execute(toolArgs(name, change), exec);
    expect(request).toHaveBeenLastCalledWith(
      'session',
      { kind, change },
      signal,
    );
  }
  await open.execute({}, exec);
  expect(request).toHaveBeenLastCalledWith(
    'session',
    { kind: 'read', requireVisible: true },
    signal,
  );
  for (const dispose of disposers.reverse()) dispose();
});

it('registers tools and authenticated routes for the plugin lifetime', async () => {
  vi.useFakeTimers();
  const tools = new Map<string, ToolDefinition>();
  const disposers: (() => void)[] = [];
  const unregister = vi.fn();
  let route: WebRoute | undefined;
  const ctx = {
    webServer: {
      host: '127.0.0.1',
      port: 1234,
      register: (value: WebRoute) => {
        route = value;
        return unregister;
      },
    },
    connection: { requestRejection: vi.fn(() => 401) },
    tools: {
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition);
      },
    },
    effect: (start: () => () => void) => {
      disposers.push(start());
    },
  };
  apply(ctx as unknown as Context);
  expect([...tools.keys()]).toEqual([
    'list_pptx_images',
    'add_pptx_image',
    'open_pptx',
    'read_pptx',
    'operate_pptx',
    'edit_pptx',
    'edit_pptx_batch',
    'add_pptx_slide',
    'add_pptx_text',
  ]);
  const malformedExec = {} as Parameters<ToolDefinition['execute']>[1];
  expect(() =>
    tools
      .get('operate_pptx')
      ?.execute({ action: { operation: 'update-chart' } }, malformedExec),
  ).toThrow(
    /Invalid PPTX arguments.*nothing changed.*action.*retain the required fields/,
  );
  expect(() =>
    tools.get('edit_pptx')?.execute(undefined, malformedExec),
  ).toThrow(/arguments:.*root/);
  for (const tool of tools.values()) {
    expect(tool.parameters).toMatchObject({ type: 'object' });
    expect(tool.parameters).not.toHaveProperty('anyOf');
    expect(tool.parameters).not.toHaveProperty('oneOf');
  }
  if (!route) throw new Error('Route missing');
  const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
  await route.handler(
    { headers: {} } as Parameters<WebRoute['handler']>[0],
    res as unknown as Parameters<WebRoute['handler']>[1],
  );
  expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
  const exec = { signal: new AbortController().signal } as Parameters<
    ToolDefinition['execute']
  >[1];
  expect(() => tools.get('open_pptx')?.execute({}, exec)).toThrow(
    'conversation',
  );
  expect(
    tools.get('open_pptx')?.output.render({}, { preview: 'ready' }),
  ).toEqual([{ type: 'text', text: '{"preview":"ready"}' }]);
  const edit = {
    documentId: crypto.randomUUID(),
    version: 0,
    slideIndex: 0,
    elementId: 'e',
    summary: 'Synthetic edit',
    patch: { x: 30 },
  };
  for (const [name, args] of [
    ['read_pptx', {}],
    ['edit_pptx', edit],
    [
      'edit_pptx_batch',
      {
        documentId: edit.documentId,
        version: 0,
        summary: 'Batch',
        edits: [{ slideIndex: 0, elementId: 'e', patch: { x: 30 } }],
      },
    ],
    [
      'operate_pptx',
      {
        documentId: edit.documentId,
        version: 0,
        summary: 'Navigate',
        operation: 'navigate',
        slideIndex: 0,
      },
    ],
    [
      'add_pptx_slide',
      { documentId: edit.documentId, version: 0, summary: 'Insert slide' },
    ],
    [
      'add_pptx_text',
      {
        documentId: edit.documentId,
        version: 0,
        summary: 'Insert text',
        slideIndex: 0,
        text: 'Hello',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      },
    ],
  ] as const) {
    const tool = tools.get(name);
    if (!tool) throw new Error('Tool missing');
    expect(() => tool.execute(toolArgs(name, args), exec)).toThrow(
      'conversation',
    );
    await expect(
      tool.execute(toolArgs(name, args), {
        ...exec,
        agent: { id: 's', session: { snapshotEvents: () => [] } },
      } as unknown as typeof exec),
    ).rejects.toThrow('Open');
    expect(tool.output.render({}, { status: 'applied' })).toEqual([
      { type: 'text', text: '{"status":"applied"}' },
    ]);
  }
  await vi.advanceTimersByTimeAsync(5000);
  for (const dispose of disposers.reverse()) dispose();
  expect(unregister).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  ctx.webServer.host = '0.0.0.0';
  expect(() => {
    apply(ctx as unknown as Context);
  }).toThrow('loopback');
});
