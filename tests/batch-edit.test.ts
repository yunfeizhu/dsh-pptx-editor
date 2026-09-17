import { expect, it, vi } from 'vitest';
import { DocumentSession, type EditorPort } from '../src/document-session.js';
import { batchEditSchema, type BatchEditInput } from '../src/protocol.js';
import { operationFixture } from './operation-fixture.js';

function setup() {
  const { editor, commit } = operationFixture();
  const file = {
    name: 'synthetic.pptx',
    read: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    write: vi.fn(async () => {}),
  };
  const session = new DocumentSession(
    file,
    new Uint8Array([1]),
    editor,
    commit,
  );
  const input = (): BatchEditInput => ({
    documentId: session.id,
    version: session.read().version,
    summary: 'Batch format',
    edits: [
      { slideIndex: 0, elementId: 'a', patch: { x: 30 } },
      { slideIndex: 0, elementId: 'b', patch: { y: 80 } },
    ],
  });
  return { editor, session, file, input };
}

it('applies one public batch, verifies it and keeps single-step undo independent of prior edits', async () => {
  const { editor, session, file, input } = setup();
  session.applyEdit({
    documentId: session.id,
    version: session.read().version,
    summary: 'Prior edit',
    slideIndex: 0,
    elementId: 'c',
    patch: { x: 300 },
  });
  const before = session.read();
  const change = input();
  expect(await session.applyBatchEdit(change)).toMatchObject({
    status: 'applied',
    undoSteps: 1,
  });
  expect(editor.updateElements).toHaveBeenCalledOnce();
  expect(editor.getActiveSlideIndex()).toBe(0);
  expect(editor.getSelectedElementIds()).toEqual(['c']);
  expect(file.write).not.toHaveBeenCalled();
  await expect(session.applyBatchEdit(change)).rejects.toThrow('Stale');
  editor.undo();
  expect(session.read().slides).toEqual(before.slides);
});

it.each([
  'missing-element',
  'missing-slide',
  'unsupported-text',
  'duplicate',
  'stale',
  'foreign',
] as const)('rejects the entire batch before mutation: %s', async (kind) => {
  const { editor, session, input } = setup();
  const change = input();
  const second = change.edits[1];
  if (!second) throw new Error('Missing fixture');
  if (kind === 'missing-element') second.elementId = 'missing';
  if (kind === 'missing-slide') second.slideIndex = 9;
  if (kind === 'unsupported-text') {
    const slide = editor.getSlides()[0];
    if (!slide) throw new Error('Missing slide');
    slide.elements.push({
      id: 'picture',
      type: 'image',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      imageData: 'data:image/png;base64,AA==',
    });
    second.elementId = 'picture';
    second.patch = { text: 'Not a text box' };
    change.version = session.read().version;
  }
  if (kind === 'duplicate') second.elementId = 'a';
  if (kind === 'stale') change.version += 1;
  if (kind === 'foreign') change.documentId = crypto.randomUUID();
  const before = session.read();
  await expect(session.applyBatchEdit(change)).rejects.toThrow();
  expect(editor.updateElements).not.toHaveBeenCalled();
  expect(session.read()).toEqual(before);
});

it('bounds batch size and rejects unknown mutation fields', () => {
  const { input } = setup();
  const change = input();
  expect(batchEditSchema.safeParse({ ...change, edits: [] }).success).toBe(
    false,
  );
  expect(
    batchEditSchema.safeParse({
      ...change,
      edits: Array.from({ length: 101 }, (_, i) => ({
        slideIndex: 0,
        elementId: String(i),
        patch: { x: 1 },
      })),
    }).success,
  ).toBe(false);
  expect(
    batchEditSchema.safeParse({
      ...change,
      edits: [{ slideIndex: 0, elementId: 'a', patch: { id: 'other' } }],
    }).success,
  ).toBe(false);
});

it('reports a no-op without inventing a new undo step or document version', async () => {
  const { editor, session, input } = setup();
  editor.updateElements = vi.fn(async () => {});
  const change = input();
  change.edits = [{ slideIndex: 0, elementId: 'a', patch: { x: 0 } }];
  const before = session.read();
  expect(await session.applyBatchEdit(change)).toMatchObject({
    status: 'unchanged',
    undoSteps: 0,
    version: before.version,
  });
  expect(session.read()).toEqual(before);
});

it.each(['rejected', 'ignored', 'missing', 'disposed'] as const)(
  'does not claim a verified batch after %s',
  async (kind) => {
    const { editor, session, input } = setup();
    const change = input();
    editor.updateElements = vi.fn(async () => {
      await Promise.resolve();
      if (kind === 'rejected') throw new Error('Viewer refused');
      if (kind === 'missing') {
        const slide = editor.getSlides()[0];
        if (slide) slide.elements = [];
      }
      if (kind === 'disposed') session.dispose();
    });
    await expect(session.applyBatchEdit(change)).rejects.toThrow();
    expect(session.lastEdit?.status).toBe('failed');
    expect(
      kind === 'disposed'
        ? session.lastEdit?.status
        : session.read().lastEdit?.status,
    ).toBe('failed');
  },
);

it('fences reads, saves and competing edits until the public async commit settles', async () => {
  const { editor, session, input } = setup();
  const change = input();
  const original = editor.updateElements;
  const ready = Promise.withResolvers<undefined>();
  editor.updateElements = vi.fn<EditorPort['updateElements']>(
    async (...args) => {
      await ready.promise;
      await original(...args);
    },
  );
  const pending = session.applyBatchEdit(change);
  expect(() => session.read()).toThrow('Batch edit in progress');
  await expect(session.save()).rejects.toThrow('Batch edit in progress');
  await expect(session.applyBatchEdit(change)).rejects.toThrow(
    'Batch edit in progress',
  );
  ready.resolve(undefined);
  await pending;
  expect(session.read().lastEdit?.status).toBe('applied');
});
