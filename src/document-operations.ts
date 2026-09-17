import type { PowerPointViewerAPI } from 'pptx-react-viewer';
import type { OperationInput } from './protocol.js';
import { elementPatch, type Element } from './element-format.js';
import { createTable, updateTable } from './table-editing.js';
import { createChart, updateChart } from './chart-editing.js';
import { updateImage } from './image-editing.js';

export type OperationPort = Pick<
  PowerPointViewerAPI,
  | 'getSlides'
  | 'getActiveSlideIndex'
  | 'setActiveSlideIndex'
  | 'deleteSlides'
  | 'duplicateSlides'
  | 'moveSlide'
  | 'toggleHideSlides'
  | 'addElement'
  | 'selectElements'
  | 'deleteElements'
  | 'updateElement'
  | 'undo'
  | 'redo'
  | 'canUndo'
  | 'canRedo'
>;
type Commit = (action: () => void) => void;

function verify(condition: boolean): asserts condition {
  if (!condition)
    throw new Error(
      'Editor did not apply the complete operation. Some changes may remain; read again before retrying.',
    );
}

function found<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected editor target missing; read again');
  return value;
}

function targetElements(
  editor: OperationPort,
  slideIndex: number,
  ids: string[],
) {
  const slide = editor.getSlides()[slideIndex];
  if (!slide) throw new Error('Slide not found');
  return ids.map((id) => {
    const element = slide.elements.find((item) => item.id === id);
    if (!element) throw new Error('Element not found on this slide');
    return element;
  });
}

/** Commit navigation only after the request and its target have been validated. */
export function selectSlide(
  editor: OperationPort,
  commit: Commit,
  slideIndex: number,
) {
  if (editor.getActiveSlideIndex() === slideIndex) return;
  commit(() => {
    editor.setActiveSlideIndex(slideIndex);
  });
  verify(editor.getActiveSlideIndex() === slideIndex);
}

/** Geometry alignment is explicit and never stands in for paragraph alignment. */
export function arrangementPatches(
  elements: Element[],
  arrangement: Extract<
    OperationInput,
    { operation: 'arrange-elements' }
  >['arrangement'],
) {
  if (elements.length < (arrangement.startsWith('distribute') ? 3 : 2))
    throw new Error(
      'Alignment needs at least two elements; distribution needs three',
    );
  if (
    elements.some(
      (el) => (el.rotation ?? 0) % 360 !== 0 || el.skewX || el.skewY,
    )
  )
    throw new Error('Arrange rotated or skewed elements manually');
  const horizontal = [
    'left',
    'center',
    'right',
    'distribute-horizontal',
  ].includes(arrangement);
  const position = horizontal ? 'x' : 'y';
  const dimension = horizontal ? 'width' : 'height';
  const sorted = [...elements].sort((a, b) => a[position] - b[position]);
  const start = Math.min(...elements.map((el) => el[position]));
  const end = Math.max(...elements.map((el) => el[position] + el[dimension]));
  const totalSize = elements.reduce((sum, el) => sum + el[dimension], 0);
  const gap = (end - start - totalSize) / (elements.length - 1);
  if (arrangement.startsWith('distribute') && gap < 0)
    throw new Error('Not enough space for non-overlapping distribution');
  let cursor = start;
  return sorted.map((el) => {
    let value: number;
    if (arrangement.startsWith('distribute')) {
      value = cursor;
      cursor += el[dimension] + gap;
    } else if (['left', 'top'].includes(arrangement)) value = start;
    else if (['right', 'bottom'].includes(arrangement))
      value = end - el[dimension];
    else value = (start + end - el[dimension]) / 2;
    return { id: el.id, patch: { [position]: value } };
  });
}

export function insert(
  editor: OperationPort,
  commit: Commit,
  slideIndex: number,
  model: Element,
) {
  targetElements(editor, slideIndex, []);
  const before = found(editor.getSlides()[slideIndex]).elements.map(
    (el) => el.id,
  );
  selectSlide(editor, commit, slideIndex);
  let id: string | undefined;
  commit(() => {
    id = editor.addElement(model);
  });
  const after = found(editor.getSlides()[slideIndex]).elements;
  verify(
    Boolean(id) &&
      !before.includes(found(id)) &&
      after.length === before.length + 1 &&
      before.every((old, index) => after[index]?.id === old),
  );
  const actual = after.find((el) => el.id === id);
  verify(
    Boolean(actual) &&
      found(actual).type === model.type &&
      found(actual).x === model.x &&
      found(actual).y === model.y &&
      found(actual).width === model.width &&
      found(actual).height === model.height,
  );
  return { elementId: found(id), slideIndex };
}

/** All mutations use the live viewer. No independent presentation or history is kept. */
export function runOperation(
  editor: OperationPort,
  change: OperationInput,
  commit: Commit,
): Record<string, unknown> {
  const { operation } = change;
  const slides = editor.getSlides();
  if ('slideIndex' in change && !slides[change.slideIndex])
    throw new Error('Slide not found');
  if (operation === 'undo' || operation === 'redo') {
    if (!(operation === 'undo' ? editor.canUndo() : editor.canRedo()))
      throw new Error(`Nothing to ${operation}`);
    const before = JSON.stringify(slides);
    commit(() => {
      if (operation === 'undo') editor.undo();
      else editor.redo();
    });
    verify(JSON.stringify(editor.getSlides()) !== before);
    return { operation, activeSlideIndex: editor.getActiveSlideIndex() };
  }
  if (operation === 'navigate') {
    commit(() => {
      editor.setActiveSlideIndex(change.slideIndex);
    });
    verify(editor.getActiveSlideIndex() === change.slideIndex);
    return { operation, activeSlideIndex: change.slideIndex };
  }
  if (
    operation === 'delete-slide' ||
    operation === 'duplicate-slide' ||
    operation === 'move-slide' ||
    operation === 'set-slide-hidden'
  ) {
    const index = change.slideIndex;
    const before = slides.map((slide) => slide.id);
    const expected = [...before];
    if (operation === 'delete-slide') {
      if (slides.length === 1) throw new Error('Cannot delete the last slide');
      expected.splice(index, 1);
      commit(() => {
        editor.deleteSlides([index]);
      });
    } else if (operation === 'duplicate-slide') {
      commit(() => {
        editor.duplicateSlides([index]);
      });
      const after = editor.getSlides();
      const added = after[index + 1];
      verify(Boolean(added) && !before.includes(found(added).id));
      expected.splice(index + 1, 0, found(added).id);
      commit(() => {
        editor.setActiveSlideIndex(index + 1);
      });
      verify(editor.getActiveSlideIndex() === index + 1);
    } else if (operation === 'move-slide') {
      if (!slides[change.toIndex])
        throw new Error('Destination slide not found');
      expected.splice(change.toIndex, 0, found(expected.splice(index, 1)[0]));
      commit(() => {
        editor.moveSlide(index, change.toIndex);
      });
    } else if (Boolean(found(slides[index]).hidden) !== change.hidden) {
      commit(() => {
        editor.toggleHideSlides([index]);
      });
    }
    const after = editor.getSlides();
    verify(
      JSON.stringify(after.map((slide) => slide.id)) ===
        JSON.stringify(expected),
    );
    if (operation === 'set-slide-hidden')
      verify(Boolean(found(after[index]).hidden) === change.hidden);
    return {
      operation,
      slideCount: after.length,
      activeSlideIndex: editor.getActiveSlideIndex(),
    };
  }
  if (operation === 'add-shape') {
    const model: Extract<Element, { type: 'shape' }> = {
      id: crypto.randomUUID(),
      type: 'shape',
      shapeType: change.shape,
      x: change.x,
      y: change.y,
      width: change.width,
      height: change.height,
      shapeStyle: {
        fillColor: '#dbeafe',
        fillMode: 'solid',
        strokeColor: '#2563eb',
        strokeWidth: 1,
      },
    };
    Object.assign(
      model,
      elementPatch(model, {
        ...(change.text !== undefined ? { text: change.text } : {}),
        ...(change.textStyle ? { textStyle: change.textStyle } : {}),
        ...(change.shapeStyle ? { shapeStyle: change.shapeStyle } : {}),
      }),
    );
    return { operation, ...insert(editor, commit, change.slideIndex, model) };
  }
  if (operation === 'add-table' || operation === 'add-chart') {
    const model: Element = {
      id: crypto.randomUUID(),
      x: change.x,
      y: change.y,
      width: change.width,
      height: change.height,
      ...(change.operation === 'add-table'
        ? { type: 'table', tableData: createTable(change.table, change.height) }
        : { type: 'chart', chartData: createChart(change.chart) }),
    };
    return { operation, ...insert(editor, commit, change.slideIndex, model) };
  }
  if (
    operation === 'update-table' ||
    operation === 'update-chart' ||
    operation === 'update-image'
  ) {
    const element = found(
      targetElements(editor, change.slideIndex, [change.elementId])[0],
    );
    const patch =
      change.operation === 'update-table'
        ? updateTable(element, change.update)
        : change.operation === 'update-chart'
          ? updateChart(element, change.update)
          : updateImage(element, change.update);
    selectSlide(editor, commit, change.slideIndex);
    commit(() => {
      editor.updateElement(element.id, patch);
    });
    const actual = found(
      targetElements(editor, change.slideIndex, [element.id])[0],
    );
    verify(
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(Reflect.get(actual, key)) === JSON.stringify(value),
      ),
    );
    return {
      operation,
      elementId: element.id,
      slideIndex: change.slideIndex,
      undoSteps: 1,
    };
  }
  if (operation === 'duplicate-element') {
    const [source] = targetElements(editor, change.slideIndex, [
      change.elementId,
    ]);
    // The released duplicateElement return/selection is stale. addElement owns fresh IDs.
    const model = structuredClone(found(source));
    model.x += change.offsetX;
    model.y += change.offsetY;
    return { operation, ...insert(editor, commit, change.slideIndex, model) };
  }
  const elements = targetElements(editor, change.slideIndex, change.elementIds);
  if (operation === 'delete-elements') {
    const expected = found(slides[change.slideIndex])
      .elements.filter((el) => !change.elementIds.includes(el.id))
      .map((el) => el.id);
    selectSlide(editor, commit, change.slideIndex);
    // Selection must commit first: the released deleteElements reads captured selection.
    commit(() => {
      editor.selectElements(change.elementIds);
    });
    commit(() => {
      editor.deleteElements(change.elementIds);
    });
    verify(
      JSON.stringify(
        found(editor.getSlides()[change.slideIndex]).elements.map(
          (el) => el.id,
        ),
      ) === JSON.stringify(expected),
    );
    return { operation, deletedElementIds: change.elementIds };
  }
  const patches = arrangementPatches(elements, change.arrangement);
  selectSlide(editor, commit, change.slideIndex);
  let changed = 0;
  for (const { id, patch } of patches) {
    const element = found(elements.find((el) => el.id === id));
    if (
      Object.entries(patch).every(
        ([key, value]) => Reflect.get(element, key) === value,
      )
    )
      continue;
    // Separate public updates intentionally produce separate history entries.
    commit(() => {
      editor.updateElement(id, patch);
    });
    const actual = found(editor.getSlides()[change.slideIndex]).elements.find(
      (el) => el.id === id,
    );
    verify(
      Boolean(actual) &&
        Object.entries(patch).every(
          ([key, value]) => Reflect.get(found(actual), key) === value,
        ),
    );
    changed += 1;
  }
  return { operation, changedElements: changed, undoSteps: changed };
}
