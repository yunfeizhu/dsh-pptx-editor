import { expect, it, vi } from 'vitest';
import {
  arrangementPatches,
  runOperation,
} from '../src/document-operations.js';
import { DocumentSession } from '../src/document-session.js';
import { operationSchema } from '../src/protocol.js';
import { operationFixture } from './operation-fixture.js';

function setup() {
  const { editor, commit } = operationFixture();
  const run = (input: Record<string, unknown>) =>
    runOperation(
      editor,
      operationSchema.parse({
        documentId: crypto.randomUUID(),
        version: 0,
        summary: 'Test operation',
        ...input,
      }),
      commit,
    );
  return { editor, run };
}

it('navigates, copies, reorders, hides and deletes pages and preserves one page', () => {
  const { editor, run } = setup();
  run({ operation: 'navigate', slideIndex: 1 });
  expect(editor.getActiveSlideIndex()).toBe(1);
  run({ operation: 'duplicate-slide', slideIndex: 0 });
  expect(editor.getSlides()).toHaveLength(3);
  expect(editor.getActiveSlideIndex()).toBe(1);
  const copy = editor.getSlides()[1]?.id;
  run({ operation: 'move-slide', slideIndex: 1, toIndex: 2 });
  expect(editor.getSlides()[2]?.id).toBe(copy);
  run({ operation: 'set-slide-hidden', slideIndex: 2, hidden: true });
  run({ operation: 'set-slide-hidden', slideIndex: 2, hidden: true });
  expect(editor.toggleHideSlides).toHaveBeenCalledOnce();
  run({ operation: 'set-slide-hidden', slideIndex: 2, hidden: false });
  expect(editor.getSlides()[2]?.hidden).toBe(false);
  run({ operation: 'delete-slide', slideIndex: 2 });
  run({ operation: 'delete-slide', slideIndex: 1 });
  expect(() => run({ operation: 'delete-slide', slideIndex: 0 })).toThrow(
    'last slide',
  );
  expect(() =>
    run({ operation: 'move-slide', slideIndex: 0, toIndex: 10 }),
  ).toThrow('Destination');
  expect(() => run({ operation: 'navigate', slideIndex: 2 })).toThrow(
    'Slide not found',
  );
});

it('inserts formatted shapes, duplicates with fresh IDs and deletes only requested elements', () => {
  const { editor, run } = setup();
  const shape = run({
    operation: 'add-shape',
    slideIndex: 0,
    shape: 'ellipse',
    x: 300,
    y: 200,
    width: 100,
    height: 100,
    text: 'Center',
    textStyle: { align: 'center', vAlign: 'middle' },
    shapeStyle: { fillColor: '#123456' },
  });
  expect(editor.getSlides()[0]?.elements.at(-1)).toMatchObject({
    type: 'shape',
    shapeType: 'ellipse',
    text: 'Center',
    textStyle: { align: 'center' },
    shapeStyle: { fillColor: '#123456' },
  });
  const copied = run({
    operation: 'duplicate-element',
    slideIndex: 0,
    elementId: shape.elementId,
    offsetX: 50,
    offsetY: 60,
  });
  expect(copied.elementId).not.toBe(shape.elementId);
  expect(editor.getSlides()[0]?.elements.at(-1)).toMatchObject({
    x: 350,
    y: 260,
    text: 'Center',
  });
  run({ operation: 'delete-elements', slideIndex: 0, elementIds: ['a', 'b'] });
  expect(editor.selectElements).toHaveBeenLastCalledWith(['a', 'b']);
  expect(editor.getSlides()[0]?.elements.map((el) => el.id)).toEqual([
    'c',
    shape.elementId,
    copied.elementId,
  ]);
  run({
    operation: 'add-shape',
    slideIndex: 0,
    shape: 'rect',
    x: 0,
    y: 0,
    width: 20,
    height: 10,
  });
  expect(() =>
    run({ operation: 'duplicate-element', slideIndex: 1, elementId: 'c' }),
  ).toThrow('not found');
  expect(() =>
    run({
      operation: 'delete-elements',
      slideIndex: 0,
      elementIds: ['missing'],
    }),
  ).toThrow('not found');
});

it('aligns edges/centers and distributes gaps with explicit per-element undo counts', () => {
  const { editor, run } = setup();
  const elements = editor.getSlides()[0]?.elements ?? [];
  for (const [arrangement, key, values] of [
    ['left', 'x', [0, 0, 0]],
    ['center', 'x', [60, 60, 60]],
    ['right', 'x', [120, 120, 120]],
    ['top', 'y', [0, 0, 0]],
    ['middle', 'y', [50, 50, 50]],
    ['bottom', 'y', [100, 100, 100]],
    ['distribute-horizontal', 'x', [0, 60, 120]],
    ['distribute-vertical', 'y', [0, 50, 100]],
  ] as const)
    expect(
      arrangementPatches(elements, arrangement).map(({ patch }) => patch[key]),
    ).toEqual(values);
  expect(() => arrangementPatches(elements.slice(0, 1), 'left')).toThrow(
    'two elements',
  );
  expect(() =>
    arrangementPatches(
      elements.map((el) => ({ ...el, rotation: 45 })),
      'left',
    ),
  ).toThrow('rotated');
  expect(() =>
    arrangementPatches(
      elements.map((el) => ({ ...el, width: 300 })),
      'distribute-horizontal',
    ),
  ).toThrow('Not enough space');
  expect(
    run({
      operation: 'arrange-elements',
      slideIndex: 0,
      elementIds: ['a', 'b', 'c'],
      arrangement: 'distribute-horizontal',
    }),
  ).toMatchObject({ changedElements: 1, undoSteps: 1 });
  expect(editor.getSlides()[0]?.elements[1]?.x).toBe(60);
  run({ operation: 'undo' });
  expect(editor.getSlides()[0]?.elements[1]?.x).toBe(45);
  run({ operation: 'redo' });
  expect(editor.getSlides()[0]?.elements[1]?.x).toBe(60);
  expect(() => run({ operation: 'redo' })).toThrow('Nothing');
});

it('detects viewer no-ops instead of reporting successful mutations', () => {
  for (const [method, operation] of [
    ['setActiveSlideIndex', { operation: 'navigate', slideIndex: 1 }],
    ['duplicateSlides', { operation: 'duplicate-slide', slideIndex: 0 }],
    ['deleteSlides', { operation: 'delete-slide', slideIndex: 1 }],
    [
      'toggleHideSlides',
      { operation: 'set-slide-hidden', slideIndex: 0, hidden: true },
    ],
    [
      'deleteElements',
      { operation: 'delete-elements', slideIndex: 0, elementIds: ['a'] },
    ],
    [
      'updateElement',
      {
        operation: 'arrange-elements',
        slideIndex: 0,
        elementIds: ['a', 'b'],
        arrangement: 'left',
      },
    ],
  ] as const) {
    const { editor, run } = setup();
    vi.spyOn(editor, method).mockImplementation(() => {});
    expect(() => run(operation)).toThrow('read again');
  }
  const { editor, run } = setup();
  vi.mocked(editor.addElement).mockReturnValue(undefined);
  expect(() =>
    run({ operation: 'duplicate-element', slideIndex: 0, elementId: 'a' }),
  ).toThrow('read again');
  run({ operation: 'set-slide-hidden', slideIndex: 0, hidden: true });
  vi.mocked(editor.undo).mockImplementation(() => {});
  expect(() => run({ operation: 'undo' })).toThrow('read again');
});

it('preserves session, mode, save and stale/replay guards without granting file authority', async () => {
  const { editor, commit } = operationFixture();
  const file = {
    name: 'synthetic.pptx',
    read: vi.fn(() => Promise.resolve(new Uint8Array([1, 2]))),
    write: vi.fn(() => Promise.resolve()),
  };
  const session = new DocumentSession(
    file,
    new Uint8Array([1, 2]),
    editor,
    commit,
  );
  const input = () => ({
    documentId: session.id,
    version: session.read().version,
    summary: 'Navigate',
    operation: 'navigate' as const,
    slideIndex: 1,
  });
  const first = input();
  session.operate(first);
  expect(() => session.operate(first)).toThrow('Stale');
  expect(session.dirty).toBe(false);
  expect(file.write).not.toHaveBeenCalled();
  expect(() =>
    session.operate({ ...input(), documentId: crypto.randomUUID() }),
  ).toThrow('Stale');
  vi.mocked(editor.getMode).mockReturnValue('present');
  expect(() => session.operate(input())).toThrow('edit mode');
  vi.mocked(editor.getMode).mockReturnValue('edit');
  const pending = Promise.withResolvers<Uint8Array>();
  vi.mocked(editor.getContent).mockReturnValue(pending.promise);
  const next = input();
  const saving = session.save();
  expect(() => session.operate(next)).toThrow('Save in progress');
  pending.resolve(new Uint8Array([1, 2]));
  await saving;
  session.dispose();
  expect(() => session.operate(next)).toThrow('closed');
  expect(
    operationSchema.safeParse({
      ...next,
      operation: 'delete-elements',
      elementIds: ['a', 'a'],
    }).success,
  ).toBe(false);
});

it.each([
  { operation: 'delete-elements', slideIndex: 1, elementIds: ['a'] },
  { operation: 'delete-elements', slideIndex: 0, elementIds: ['missing'] },
  {
    operation: 'arrange-elements',
    slideIndex: 0,
    elementIds: ['a'],
    arrangement: 'left',
  },
  { operation: 'redo' },
])(
  'does not consume a version or overwrite the receipt for a pre-mutation rejection: $operation',
  (invalid) => {
    const { editor, commit } = operationFixture();
    const file = {
      name: 'synthetic.pptx',
      read: () => Promise.resolve(new Uint8Array([1])),
      write: vi.fn(),
    };
    const session = new DocumentSession(
      file,
      new Uint8Array([1]),
      editor,
      commit,
    );
    const input = (
      state: ReturnType<DocumentSession['read']>,
      operation: Record<string, unknown>,
    ) =>
      operationSchema.parse({
        documentId: state.documentId,
        version: state.version,
        summary: 'Precondition regression',
        ...operation,
      });
    session.operate(
      input(session.read(), { operation: 'navigate', slideIndex: 0 }),
    );
    const before = session.read();
    expect(() => session.operate(input(before, invalid))).toThrow();
    expect(session.read()).toEqual(before);
    expect(editor.selectElements).not.toHaveBeenCalled();
    expect(editor.deleteElements).not.toHaveBeenCalled();
    expect(editor.updateElement).not.toHaveBeenCalled();
    expect(
      session.operate(input(before, { operation: 'navigate', slideIndex: 1 }))
        .status,
    ).toBe('applied');
    expect(editor.getActiveSlideIndex()).toBe(1);
    expect(file.write).not.toHaveBeenCalled();
  },
);

it('invalidates the request once an operation has attempted a viewer mutation', () => {
  const { editor, commit } = operationFixture();
  const session = new DocumentSession(
    {
      name: 'synthetic.pptx',
      read: () => Promise.resolve(new Uint8Array([1])),
      write: vi.fn(),
    },
    new Uint8Array([1]),
    editor,
    commit,
  );
  const before = session.read();
  const input = operationSchema.parse({
    documentId: before.documentId,
    version: before.version,
    summary: 'Partial failure',
    operation: 'delete-elements',
    slideIndex: 0,
    elementIds: ['a'],
  });
  vi.mocked(editor.deleteElements).mockImplementationOnce(() => {
    throw new Error('Viewer failed');
  });
  expect(() => session.operate(input)).toThrow('Viewer failed');
  expect(editor.selectElements).toHaveBeenCalledOnce();
  expect(session.read().version).toBeGreaterThan(before.version);
  expect(session.read().lastEdit?.status).toBe('failed');
  expect(() => session.operate(input)).toThrow('Stale');
  expect(editor.deleteElements).toHaveBeenCalledOnce();
});
