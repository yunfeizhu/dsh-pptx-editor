import { vi } from 'vitest';
import type { EditorPort } from '../src/document-session.js';
import type { Element } from '../src/element-format.js';

export function operationFixture() {
  type Slide = ReturnType<EditorPort['getSlides']>[number];
  const element = (id: string, x: number, y: number): Element => ({
    type: 'shape',
    id,
    x,
    y,
    width: 20,
    height: 10,
    shapeType: 'rect',
  });
  let slides: Slide[] = [
    {
      id: 's1',
      rId: 'r1',
      slideNumber: 1,
      elements: [
        element('a', 0, 0),
        element('b', 45, 40),
        element('c', 120, 100),
      ],
    },
    { id: 's2', rId: 'r2', slideNumber: 2, elements: [] },
  ];
  let active = 0;
  let selected = ['c'];
  const past: Slide[][] = [];
  const future: Slide[][] = [];
  const record = () => {
    past.push(structuredClone(slides));
    future.length = 0;
  };
  const target = () => {
    const slide = slides[active];
    if (!slide) throw new Error('Fixture slide missing');
    return slide;
  };
  const editor: EditorPort = {
    getSlides: () => slides,
    getSelectedElementIds: () => selected,
    getActiveSlideIndex: () => active,
    getMode: vi.fn<EditorPort['getMode']>(() => 'edit'),
    setActiveSlideIndex: vi.fn<EditorPort['setActiveSlideIndex']>((index) => {
      active = index;
    }),
    addSlide: vi.fn<EditorPort['addSlide']>((index = active) => {
      record();
      slides.splice(index + 1, 0, {
        id: crypto.randomUUID(),
        rId: 'new',
        slideNumber: 3,
        elements: [],
      });
      active = index + 1;
    }),
    deleteSlides: vi.fn<EditorPort['deleteSlides']>(([index = 0]) => {
      record();
      slides.splice(index, 1);
      active = Math.min(active, slides.length - 1);
    }),
    duplicateSlides: vi.fn<EditorPort['duplicateSlides']>(([index = 0]) => {
      record();
      const source = slides[index];
      if (!source) throw new Error('Missing source');
      slides.splice(index + 1, 0, {
        ...structuredClone(source),
        id: crypto.randomUUID(),
      });
    }),
    moveSlide: vi.fn<EditorPort['moveSlide']>((from, to) => {
      record();
      const source = slides.splice(from, 1)[0];
      if (!source) throw new Error('Missing source');
      slides.splice(to, 0, source);
      active = to;
    }),
    toggleHideSlides: vi.fn<EditorPort['toggleHideSlides']>((indexes) => {
      record();
      for (const index of indexes) {
        const slide = slides[index];
        if (slide) slide.hidden = !slide.hidden;
      }
    }),
    selectElements: vi.fn<EditorPort['selectElements']>((ids) => {
      selected = [...ids];
    }),
    deleteElements: vi.fn<EditorPort['deleteElements']>(() => {
      record();
      target().elements = target().elements.filter(
        (el) => !selected.includes(el.id),
      );
    }),
    addElement: vi.fn<EditorPort['addElement']>((model) => {
      record();
      const id = crypto.randomUUID();
      target().elements.push({ ...structuredClone(model), id });
      return id;
    }),
    updateElement: vi.fn<EditorPort['updateElement']>((id, patch) => {
      record();
      Object.assign(target().elements.find((el) => el.id === id) ?? {}, patch);
    }),
    updateElements: vi.fn<EditorPort['updateElements']>(async (updates) => {
      await Promise.resolve();
      record();
      for (const { slideId, elementId, patch } of updates)
        Object.assign(
          slides
            .find((slide) => slide.id === slideId)
            ?.elements.find((el) => el.id === elementId) ?? {},
          structuredClone(patch),
        );
    }),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo: vi.fn<EditorPort['undo']>(() => {
      const before = past.pop();
      if (before) {
        future.push(slides);
        slides = before;
        active = Math.min(active, slides.length - 1);
      }
    }),
    redo: vi.fn<EditorPort['redo']>(() => {
      const next = future.pop();
      if (next) {
        past.push(slides);
        slides = next;
      }
    }),
    getContent: vi.fn<EditorPort['getContent']>(() =>
      Promise.resolve(new Uint8Array([1, 2])),
    ),
  };
  return {
    editor,
    commit: (action: () => void) => {
      action();
    },
  };
}
