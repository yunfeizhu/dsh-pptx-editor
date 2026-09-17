import { describe, expect, it, vi } from 'vitest';
import {
  DocumentSession,
  StaleDocumentError,
  type DocumentFile,
  type EditorPort,
} from '../src/document-session.js';
import {
  addSlideSchema,
  addTextSchema,
  type EditInput,
  type AddSlideInput,
  type AddTextInput,
} from '../src/protocol.js';

function first<T>(values: T[]): T {
  const value = values[0];
  if (!value) throw new Error('Fixture missing');
  return value;
}

function setup() {
  const slides: ReturnType<EditorPort['getSlides']>[number][] = [
    {
      id: 's1',
      rId: 'rId1',
      slideNumber: 1,
      elements: [
        {
          type: 'text',
          id: 't1',
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          text: 'Before',
          textSegments: [{ text: 'Before', style: { bold: true } }],
        },
      ],
    },
  ];
  let disk = new Uint8Array([1, 2]);
  const file: DocumentFile = {
    name: 'synthetic.pptx',
    read: vi.fn(() => Promise.resolve(disk.slice())),
    write: vi.fn((bytes: Uint8Array) => {
      disk = bytes.slice();
      return Promise.resolve();
    }),
  };
  let activeSlideIndex = 0;
  const editor: EditorPort = {
    getSlides: () => slides,
    getSelectedElementIds: () => [],
    getActiveSlideIndex: vi.fn(() => activeSlideIndex),
    getMode: vi.fn(() => 'edit' as const),
    addSlide: vi.fn((afterIndex: number = activeSlideIndex) => {
      activeSlideIndex = afterIndex + 1;
      slides.splice(activeSlideIndex, 0, {
        id: crypto.randomUUID(),
        rId: 'new',
        slideNumber: slides.length + 1,
        elements: [],
      });
    }),
    addElement: vi.fn((element: Parameters<EditorPort['addElement']>[0]) => {
      const id = crypto.randomUUID();
      slides[activeSlideIndex]?.elements.push({
        ...structuredClone(element),
        id,
      });
      return id;
    }),
    updateElement: vi.fn((id, patch) => {
      Object.assign(
        slides[activeSlideIndex]?.elements.find((e) => e.id === id) ?? {},
        patch,
      );
    }),
    updateElements: vi.fn(async (updates) => {
      await Promise.resolve();
      for (const { slideId, elementId, patch } of updates)
        Object.assign(
          slides
            .find((slide) => slide.id === slideId)
            ?.elements.find((el) => el.id === elementId) ?? {},
          patch,
        );
    }),
    setActiveSlideIndex: vi.fn((index: number) => {
      activeSlideIndex = index;
    }),
    deleteSlides: vi.fn(),
    duplicateSlides: vi.fn(),
    moveSlide: vi.fn(),
    toggleHideSlides: vi.fn(),
    selectElements: vi.fn(),
    deleteElements: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: () => false,
    canRedo: () => false,
    getContent: vi.fn(() => Promise.resolve(new Uint8Array([3, 4]))),
  };
  const session = new DocumentSession(file, disk, editor, (action) => {
    action();
  });
  const edit = (): EditInput => ({
    documentId: session.id,
    version: session.read().version,
    slideIndex: 0,
    elementId: 't1',
    summary: 'Update title',
    patch: { text: 'After', x: 30 },
  });
  const addSlide = (): AddSlideInput => ({
    documentId: session.id,
    version: session.read().version,
    summary: 'Add a slide',
  });
  const addText = (): AddTextInput => ({
    ...addSlide(),
    slideIndex: activeSlideIndex,
    text: 'New text',
    x: 40,
    y: 50,
    width: 400,
    height: 80,
  });
  return {
    session,
    editor,
    file,
    slides,
    edit,
    addSlide,
    addText,
    externalWrite: () => {
      disk = new Uint8Array([5]);
    },
  };
}

describe('direct editing and save integrity', () => {
  it('ignores serialization caches without weakening semantic or manual edit fences', () => {
    const { session, edit, slides } = setup();
    const slide = first(slides);
    const element = first(slide.elements);
    slide.slideNumber = 0;
    const input = edit();
    slide.id = 'ppt/slides/slide3.xml';
    slide.slideNumber = 1;
    slide.rId = 'serialized-relationship';
    slide.rawXml = { serialized: 'true' };
    element.shapeId = '42';
    element.rawXml = { serialized: 'true' };
    expect(session.read().version).toBe(input.version);
    expect(session.dirty).toBe(false);
    expect(session.applyEdit(input).status).toBe('applied');
    const next = edit();
    element.x += 1;
    expect(() => session.applyEdit(next)).toThrow('Stale edit');
    const afterMove = edit();
    element.rawXml = { unsupportedManualProperty: 'true' };
    session.invalidate(true);
    expect(() => session.applyEdit(afterMove)).toThrow('Stale edit');
    expect(session.dirty).toBe(true);
  });
  it('treats the table serializer default lock as stable but preserves explicit lock changes', () => {
    const { session, slides } = setup();
    const table: ReturnType<
      EditorPort['getSlides']
    >[number]['elements'][number] = {
      id: 'table',
      type: 'table' as const,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      tableData: { rows: [{ cells: [{ text: 'A' }] }], columnWidths: [1] },
    };
    first(slides).elements.push(table);
    const base = session.read();
    table.locks = { noGrouping: true };
    expect(session.read().version).toBe(base.version);
    table.locks.noGrouping = false;
    expect(session.read().version).toBe(base.version + 1);
    table.locks.noMove = true;
    expect(session.read().version).toBe(base.version + 2);
  });
  it.each(['reorder', 'add', 'delete', 'hidden', 'element-id'] as const)(
    'preserves the %s fence when slide archive metadata changes',
    (change) => {
      const { session, edit, slides, editor } = setup();
      const original = first(slides);
      slides.push({
        ...structuredClone(original),
        id: 's2',
        slideNumber: 2,
        elements: original.elements.map((element) => ({
          ...element,
          id: 'second-title',
        })),
      });
      const input = edit();
      for (const [index, slide] of slides.entries()) {
        slide.id = `ppt/slides/slide${String(index + 4)}.xml`;
        slide.slideNumber = index + 1;
      }
      expect(session.read().version).toBe(input.version);
      switch (change) {
        case 'reorder':
          slides.reverse();
          break;
        case 'add':
          slides.push({ id: 'blank', rId: '', slideNumber: 3, elements: [] });
          break;
        case 'delete':
          slides.pop();
          break;
        case 'hidden':
          original.hidden = true;
          break;
        case 'element-id':
          first(original.elements).id = 'different-target';
          break;
      }
      expect(() => session.applyEdit(input)).toThrow(StaleDocumentError);
      expect(editor.updateElement).not.toHaveBeenCalled();
    },
  );
  it('keeps nested semantic properties and group children in the fingerprint', () => {
    const { session, slides, edit } = setup();
    const slide = first(slides);
    const child = structuredClone(first(slide.elements));
    slide.elements.push({
      type: 'group',
      id: 'group',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      children: [child],
    });
    const before = session.read();
    child.rawXml = { serialized: 'true' };
    child.shapeId = '43';
    expect(session.read().version).toBe(before.version);
    const input = edit();
    child.width += 1;
    expect(() => session.applyEdit(input)).toThrow('Stale edit');
    const afterResize = edit();
    slide.rawTiming = { timeNode: { rawXml: 'preserved' } };
    expect(() => session.applyEdit(afterResize)).toThrow('Stale edit');
  });
  it('reports the live preview separately from the limited text projection without exporting', () => {
    const { session, editor, file, slides } = setup();
    const firstSlide = first(slides);
    slides.push({ ...firstSlide, id: 's2', slideNumber: 2, elements: [] });
    expect(session.read()).toMatchObject({
      preview: { status: 'ready', location: 'right-sidebar', slideCount: 2 },
      readProjection: {
        included: [
          'element-text',
          'geometry',
          'text-format',
          'shape-format',
          'table-cell-values',
          'chart-series',
          'image-properties',
        ],
        excluded: ['speaker-notes', 'image-text'],
      },
    });
    expect(editor.getContent).not.toHaveBeenCalled();
    expect(editor.updateElement).not.toHaveBeenCalled();
    expect(file.read).not.toHaveBeenCalled();
    expect(file.write).not.toHaveBeenCalled();
  });
  it('applies immediately exactly once, returns a new version and rejects replay', () => {
    const { session, edit, editor, file } = setup();
    const input = edit();
    const result = session.applyEdit(input);
    expect(editor.updateElement).toHaveBeenCalledExactlyOnceWith(
      't1',
      expect.objectContaining({
        text: 'After',
        x: 30,
        textSegments: [{ text: 'After', style: { bold: true } }],
      }),
    );
    expect(result).toMatchObject({
      status: 'applied',
      documentId: session.id,
      version: input.version + 1,
      slideIndex: 0,
      elementId: 't1',
    });
    expect(session.read().lastEdit?.status).toBe('applied');
    expect(session.dirty).toBe(true);
    expect(file.write).not.toHaveBeenCalled();
    expect(() => session.applyEdit(input)).toThrow('Stale');
    expect(editor.updateElement).toHaveBeenCalledOnce();
  });

  it('rejects stale edits after manual changes, undo-like transitions and interaction fences', () => {
    const { session, edit, slides, editor } = setup();
    const input = edit();
    const original = structuredClone(slides);
    first(first(slides).elements).x += 1;
    expect(() => session.applyEdit(input)).toThrow('Stale');
    slides.splice(0, 1, first(original));
    expect(() => session.applyEdit(input)).toThrow('Stale');
    const next = edit();
    session.invalidate();
    expect(() => session.applyEdit(next)).toThrow('Stale');
    expect(editor.updateElement).not.toHaveBeenCalled();
    expect(session.applyEdit(edit()).status).toBe('applied');
  });

  it('rejects stale IDs, wrong slides, unsupported elements and presentation modes', () => {
    const { session, edit, editor, slides } = setup();
    expect(() =>
      session.applyEdit({ ...edit(), documentId: crypto.randomUUID() }),
    ).toThrow(StaleDocumentError);
    expect(() => session.applyEdit({ ...edit(), version: 99 })).toThrow(
      StaleDocumentError,
    );
    expect(editor.updateElement).not.toHaveBeenCalled();
    expect(session.read().lastEdit).toBeNull();
    expect(() => session.applyEdit({ ...edit(), slideIndex: 1 })).toThrow(
      'Slide not found',
    );
    expect(() =>
      session.applyEdit({ ...edit(), elementId: 'missing' }),
    ).toThrow('not found');
    vi.mocked(editor.getMode).mockReturnValue('present');
    expect(() => session.applyEdit(edit())).toThrow('edit mode');
    vi.mocked(editor.getMode).mockReturnValue('edit');
    Object.assign(first(first(slides).elements), { type: 'image' });
    expect(() => session.applyEdit(edit())).toThrow('no editable text');
  });

  it('supports consecutive edits after a fresh read', () => {
    const { session, edit, editor } = setup();
    const firstEdit = session.applyEdit(edit());
    const secondEdit = session.applyEdit({
      ...edit(),
      patch: { text: 'Next' },
    });
    expect(secondEdit.id).not.toBe(firstEdit.id);
    expect(secondEdit.version).toBe(firstEdit.version + 1);
    expect(editor.updateElement).toHaveBeenCalledTimes(2);
  });

  it('applies geometry without text and text without existing runs', () => {
    const { session, edit, slides, editor } = setup();
    session.applyEdit({ ...edit(), patch: { y: 30, width: 400, height: 100 } });
    delete (first(first(slides).elements) as { textSegments?: unknown })
      .textSegments;
    session.applyEdit({ ...edit(), patch: { text: 'Plain' } });
    expect(editor.updateElement).toHaveBeenLastCalledWith('t1', {
      text: 'Plain',
      textSegments: [{ text: 'Plain', style: {} }],
    });
  });

  it('serializes the editor and saves only to the explicitly opened file', async () => {
    const { session, edit, file } = setup();
    session.applyEdit(edit());
    await session.save();
    expect(file.write).toHaveBeenCalledWith(new Uint8Array([3, 4]));
    expect(session.dirty).toBe(false);
    await session.save();
    expect(file.write).toHaveBeenCalledTimes(2);
  });

  it('preserves dirty state and original bytes after failures or external changes', async () => {
    const { session, edit, file, externalWrite } = setup();
    session.applyEdit(edit());
    vi.mocked(file.write).mockRejectedValueOnce(new Error('Permission denied'));
    await expect(session.save()).rejects.toThrow('Permission denied');
    expect(session.dirty).toBe(true);
    externalWrite();
    await expect(session.save()).rejects.toThrow('changed outside');
    expect(file.write).toHaveBeenCalledTimes(1);
  });

  it('refuses overlapping saves, closed documents and empty exports', async () => {
    const { session, editor, file } = setup();
    let finish!: (bytes: Uint8Array) => void;
    vi.mocked(editor.getContent).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = session.save();
    await expect(session.save()).rejects.toThrow('in progress');
    session.dispose();
    finish(new Uint8Array([3]));
    await expect(saving).rejects.toThrow('closed');
    expect(file.write).not.toHaveBeenCalled();
    expect(() => session.read()).toThrow('closed');
    const other = setup();
    vi.mocked(other.editor.getContent).mockResolvedValue(new Uint8Array());
    await expect(other.session.save()).rejects.toThrow('Invalid');
  });

  it('does not write if disposed during disk inspection', async () => {
    const { session, file } = setup();
    vi.mocked(file.read).mockImplementation(() => {
      session.dispose();
      return Promise.resolve(new Uint8Array([1, 2]));
    });
    await expect(session.save()).rejects.toThrow('closed');
    expect(file.write).not.toHaveBeenCalled();
  });
});

it('formats existing and newly inserted text through the versioned session', () => {
  const { session, editor, edit, addText, slides, file } = setup();
  const input = {
    ...edit(),
    patch: {
      textStyle: { align: 'center' as const, vAlign: 'middle' as const },
    },
  };
  session.applyEdit(input);
  expect(slides[0]?.elements[0]).toMatchObject({
    x: 10,
    width: 200,
    textStyle: { align: 'center' },
    textSegments: [{ text: 'Before', style: { bold: true, align: 'center' } }],
  });
  expect(() => session.applyEdit(input)).toThrow('Stale');
  session.addText({
    ...addText(),
    textStyle: { align: 'right', fontSize: 32 },
  });
  expect(session.read().slides[0]?.elements.at(-1)).toMatchObject({
    textStyle: { align: 'right', fontSize: 32 },
  });
  vi.mocked(editor.updateElement).mockImplementation(() => {});
  expect(() =>
    session.applyEdit({ ...edit(), patch: { textStyle: { align: 'left' } } }),
  ).toThrow('did not apply');
  expect(file.write).not.toHaveBeenCalled();
});

describe('slide and text insertion', () => {
  it('appends explicitly regardless of the active slide and inserts after a specified slide', () => {
    const { session, editor, slides, addSlide, file } = setup();
    slides.push({ ...first(slides), id: 's2', slideNumber: 2, elements: [] });
    const original = structuredClone(slides);
    const input = addSlide();
    const appended = session.addSlide(input);
    expect(editor.addSlide).toHaveBeenLastCalledWith(1);
    expect(appended).toMatchObject({
      status: 'applied',
      version: input.version + 1,
      slideIndex: 2,
      slideCount: 3,
      slideId: slides[2]?.id,
    });
    expect(slides.slice(0, 2)).toEqual(original);
    expect(session.read().activeSlideIndex).toBe(2);
    expect(session.dirty).toBe(true);
    expect(() => session.addSlide(input)).toThrow('Stale');
    const inserted = session.addSlide({ ...addSlide(), afterSlideIndex: 0 });
    expect(inserted.slideIndex).toBe(1);
    expect(slides.map((slide) => slide.id)).toEqual([
      's1',
      inserted.slideId,
      's2',
      appended.slideId,
    ]);
    expect(file.write).not.toHaveBeenCalled();
    expect(editor.getContent).not.toHaveBeenCalled();
  });

  it('adds editable text to the new active slide with a fresh ID and no disk write', () => {
    const { session, editor, file, slides, addSlide, addText } = setup();
    session.addSlide(addSlide());
    const input = { ...addText(), fontSize: 36, bold: true, color: '#123456' };
    const result = session.addText(input);
    const source = vi.mocked(editor.addElement).mock.calls[0]?.[0];
    expect(result).toMatchObject({
      status: 'applied',
      slideIndex: 1,
      version: input.version + 1,
    });
    expect(result.elementId).not.toBe(source?.id);
    expect(slides[1]?.elements[0]).toMatchObject({
      type: 'text',
      id: result.elementId,
      text: input.text,
      x: 40,
      y: 50,
      width: 400,
      height: 80,
      textStyle: { fontSize: 36, bold: true, color: '#123456' },
    });
    expect(() => session.addText(input)).toThrow('Stale');
    const next = session.read();
    session.applyEdit({
      documentId: next.documentId,
      version: next.version,
      summary: 'Edit inserted text',
      slideIndex: 1,
      elementId: result.elementId,
      patch: { text: 'Updated text' },
    });
    expect(slides[1]?.elements[0]).toMatchObject({
      text: 'Updated text',
      textSegments: [
        {
          text: 'Updated text',
          style: { fontSize: 36, bold: true, color: '#123456' },
        },
      ],
    });
    expect(file.write).not.toHaveBeenCalled();
  });

  it('uses plain text defaults and rejects invalid input before touching the editor', () => {
    const { session, editor, addSlide, addText } = setup();
    const input = addText();
    for (const patch of [
      { text: '' },
      { text: '  ' },
      { width: 0 },
      { height: -1 },
      { x: Infinity },
      { fontSize: 0 },
      { color: 'red' },
      { path: 'arbitrary.pptx' },
    ]) {
      expect(addTextSchema.safeParse({ ...input, ...patch }).success).toBe(
        false,
      );
      expect(() => session.addText({ ...input, ...patch })).toThrow();
    }
    expect(
      addSlideSchema.safeParse({ ...addSlide(), afterSlideIndex: -1 }).success,
    ).toBe(false);
    expect(() =>
      session.addSlide({ ...addSlide(), afterSlideIndex: 1 }),
    ).toThrow('Slide not found');
    expect(() => session.addText({ ...input, slideIndex: 1 })).toThrow(
      'Slide not found',
    );
    expect(editor.addSlide).not.toHaveBeenCalled();
    expect(editor.addElement).not.toHaveBeenCalled();
    session.addText(input);
    expect(editor.addElement).toHaveBeenCalledWith(
      expect.objectContaining({
        textStyle: { fontSize: 24, bold: false, color: '#000000' },
      }),
    );
  });

  it('refuses stale documents, manual changes, non-edit modes, missing slides and closed sessions', () => {
    const { session, editor, slides, addSlide, addText } = setup();
    expect(() =>
      session.addSlide({ ...addSlide(), documentId: crypto.randomUUID() }),
    ).toThrow('Stale');
    expect(() =>
      session.addText({ ...addText(), documentId: crypto.randomUUID() }),
    ).toThrow('Stale');
    const staleSlide = addSlide();
    const staleText = addText();
    first(first(slides).elements).x += 10;
    expect(() => session.addSlide(staleSlide)).toThrow('Stale');
    expect(() => session.addText(staleText)).toThrow('Stale');
    const freshSlide = addSlide();
    const freshText = addText();
    for (const mode of ['preview', 'present', 'master'] as const) {
      vi.mocked(editor.getMode).mockReturnValue(mode);
      expect(() => session.addSlide(freshSlide)).toThrow('edit mode');
      expect(() => session.addText(freshText)).toThrow('edit mode');
    }
    vi.mocked(editor.getMode).mockReturnValue('edit');
    slides.length = 0;
    expect(() => session.addSlide(addSlide())).toThrow('Slide not found');
    expect(() => session.addText(addText())).toThrow('Slide not found');
    session.dispose();
    expect(() => session.addSlide(freshSlide)).toThrow('closed');
    expect(() => session.addText(freshText)).toThrow('closed');
    expect(editor.addSlide).not.toHaveBeenCalled();
    expect(editor.addElement).not.toHaveBeenCalled();
  });

  it('blocks both insertions while saving and allows them after a failed save', async () => {
    const { session, editor, addSlide, addText } = setup();
    const slide = addSlide();
    const text = addText();
    const pending = Promise.withResolvers<Uint8Array>();
    vi.mocked(editor.getContent).mockReturnValueOnce(pending.promise);
    const saving = session.save();
    expect(() => session.addSlide(slide)).toThrow('Save in progress');
    expect(() => session.addText(text)).toThrow('Save in progress');
    pending.reject(new Error('Export failed'));
    await expect(saving).rejects.toThrow('Export failed');
    expect(session.addSlide(slide).status).toBe('applied');
  });

  it('does not claim success for a rejected, misdirected or partially failed insertion', () => {
    const { session, editor, slides, addSlide, addText } = setup();
    vi.mocked(editor.addSlide).mockImplementationOnce(() => {});
    expect(() => session.addSlide(addSlide())).toThrow('did not insert');
    vi.mocked(editor.addSlide).mockImplementationOnce(() => {
      slides.push({ ...first(slides) });
    });
    expect(() => session.addSlide(addSlide())).toThrow('did not insert');
    vi.mocked(editor.addElement).mockReturnValueOnce(undefined);
    const input = addText();
    expect(() => session.addText(input)).toThrow('did not insert');
    expect(() => session.addText(input)).toThrow('Stale');
    vi.mocked(editor.addElement).mockReturnValueOnce('t1');
    expect(() => session.addText(addText())).toThrow('did not insert');
    vi.mocked(editor.addElement).mockImplementationOnce(() => {
      throw new Error('Insertion failed');
    });
    expect(() => session.addText(addText())).toThrow('Insertion failed');
    expect(session.read().lastEdit?.status).toBe('failed');
    expect(session.dirty).toBe(true);
  });
});

it('does not claim success for a no-op editor and keeps conservative change state', async () => {
  const { session, edit, editor } = setup();
  session.invalidate(true);
  expect(session.dirty).toBe(true);
  vi.mocked(editor.updateElement).mockImplementationOnce(() => {});
  expect(() => {
    session.applyEdit(edit());
  }).toThrow('did not apply');
  expect(session.read().lastEdit?.status).toBe('failed');
  await session.save();
  expect(session.dirty).toBe(false);
});

it('rejects edits during serialization without acknowledging them as saved', async () => {
  const { session, editor, file } = setup();
  vi.mocked(editor.getContent).mockImplementationOnce(() => {
    session.invalidate(true);
    return Promise.resolve(new Uint8Array([3]));
  });
  await expect(session.save()).rejects.toThrow('changed during save');
  expect(file.write).not.toHaveBeenCalled();
  expect(session.dirty).toBe(true);
});

it('chooses the destination before serialization and retains its baseline through failed writes', async () => {
  const { session, file, editor, edit, externalWrite } = setup();
  session.applyEdit(edit());
  externalWrite();
  file.prepareWrite = vi
    .fn()
    .mockImplementationOnce(async () => {
      expect(editor.getContent).not.toHaveBeenCalled();
      return await Promise.resolve(new Uint8Array([5]));
    })
    .mockResolvedValue(undefined);
  vi.mocked(file.write).mockRejectedValueOnce(new Error('Disk full'));
  await expect(session.save()).rejects.toThrow('Disk full');
  expect(session.dirty).toBe(true);
  await session.save();
  expect(session.dirty).toBe(false);
  externalWrite();
  await expect(session.save()).rejects.toThrow('changed outside');
  expect(file.write).toHaveBeenCalledTimes(2);
});

it('does not serialize or mark an upload saved when destination selection is cancelled', async () => {
  const { session, file, editor, edit } = setup();
  session.applyEdit(edit());
  file.prepareWrite = vi
    .fn()
    .mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  await expect(session.save()).rejects.toThrow('Cancelled');
  expect(editor.getContent).not.toHaveBeenCalled();
  expect(session.dirty).toBe(true);
});

it('validates before selecting a requested slide, without weakening stale edit fences', () => {
  const { session, editor, edit, addSlide, addText } = setup();
  const stale = edit();
  session.addSlide(addSlide());
  expect(() => session.applyEdit(stale)).toThrow('Stale');
  expect(session.read().activeSlideIndex).toBe(1);
  expect(() => session.applyEdit({ ...edit(), elementId: 'missing' })).toThrow(
    'not found',
  );
  expect(session.read().activeSlideIndex).toBe(1);
  session.applyEdit(edit());
  expect(session.read().activeSlideIndex).toBe(0);
  expect(editor.getSlides()[0]?.elements[0]).toMatchObject({ text: 'After' });
  session.addText({ ...addText(), slideIndex: 1 });
  expect(session.read().activeSlideIndex).toBe(1);
  expect(editor.getSlides()[1]?.elements[0]).toMatchObject({
    text: 'New text',
  });
});
