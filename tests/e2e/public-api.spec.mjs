import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('released viewer public ref: every method, with documented compatibility exceptions', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test/public-viewer');
  await expect(
    page.getByRole('button', { name: 'Go to slide 2' }),
  ).toBeVisible();
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.viewerCall(method, args), {
      method,
      args,
    });
  expect(await call('getSlideCount')).toBe(2);
  expect(await call('getMode')).toBe('edit');
  expect(await call('isDirty')).toBe(false);
  const slides = await call('getSlides');
  expect(await call('getSlide', 0)).toEqual(slides[0]);
  expect(await call('getActiveSlide')).toEqual(slides[0]);
  expect(await call('getElements')).toEqual(slides[0].elements);
  expect(await call('getElements', 1)).toEqual(slides[1].elements);
  const title = slides[0].elements.find((el) => el.text === 'Project Atlas');
  expect(await call('getElementById', title.id)).toEqual(title);
  await call('goNext');
  expect(await call('getActiveSlideIndex')).toBe(1);
  await call('goPrev');
  expect(await call('getActiveSlideIndex')).toBe(0);
  await call('goTo', 1);
  expect(await call('getActiveSlideIndex')).toBe(1);
  await call('setActiveSlideIndex', 0);
  await call('setZoom', 1);
  expect(await call('getZoom')).toBe(1);
  await call('zoomIn');
  expect(await call('getZoom')).toBeGreaterThan(1);
  await call('zoomOut');
  expect(await call('getZoom')).toBeCloseTo(1);
  await call('zoomReset');
  expect(await call('getZoom')).toBe(1);
  await call('setMode', 'preview');
  expect(await call('getMode')).toBe('preview');
  await call('setMode', 'present');
  expect(await call('getMode')).toBe('present');
  await call('setMode', 'edit');
  expect(await call('getMode')).toBe('edit');
  await call('selectElements', [title.id]);
  expect(await call('getSelectedElementIds')).toEqual([title.id]);
  await call('clearSelection');
  expect(await call('getSelectedElementIds')).toEqual([]);
  const added = await call('addElement', {
    type: 'text',
    id: 'input-id',
    text: 'Public API text',
    x: 500,
    y: 200,
    width: 300,
    height: 80,
    textStyle: { fontSize: 24 },
  });
  expect(typeof added).toBe('string');
  expect(added).not.toBe('input-id');
  await call('updateElement', added, { x: 550 });
  expect((await call('getElementById', added)).x).toBe(550);
  expect(await call('canUndo')).toBe(true);
  expect(await call('isDirty')).toBe(true);
  await call('undo');
  expect((await call('getElementById', added)).x).toBe(500);
  expect(await call('canRedo')).toBe(true);
  await call('redo');
  expect((await call('getElementById', added)).x).toBe(550);
  const before = await call('getElements');
  // The released method consumes the old selection before its own selection commits.
  // Empty selection therefore inserts nothing despite a valid target ID.
  expect(await call('getSelectedElementIds')).toEqual([]);
  await call('duplicateElement', added);
  expect(await call('getElements')).toHaveLength(before.length);
  await call('selectElements', [added]);
  const returned = await call('duplicateElement', added);
  const after = await call('getElements');
  expect(after).toHaveLength(before.length + 1);
  const copy = after.find((el) => !before.some((old) => old.id === el.id));
  expect(copy.text).toBe('Public API text');
  // 3.18.0 duplicates correctly but returns the captured old selection's ID.
  // The plugin intentionally uses addElement for duplication instead.
  expect(returned).not.toBe(copy.id);
  await call('selectElements', [copy.id]);
  await call('deleteElements', [copy.id]);
  expect(await call('getElementById', copy.id)).toBeUndefined();
  await call('addSlide', 1);
  expect(await call('getSlideCount')).toBe(3);
  await call('duplicateSlides', [0]);
  expect(await call('getSlideCount')).toBe(4);
  const beforeMove = (await call('getSlides')).map((slide) => slide.id);
  await call('moveSlide', 1, 3);
  expect((await call('getSlides')).map((slide) => slide.id)).toEqual([
    beforeMove[0],
    beforeMove[2],
    beforeMove[3],
    beforeMove[1],
  ]);
  await call('toggleHideSlides', [3]);
  expect((await call('getSlide', 3)).hidden).toBe(true);
  await call('deleteSlides', [2]);
  expect(await call('getSlideCount')).toBe(3);
  const bytes = await page.evaluate(async () => [
    ...(await window.viewerCall('getContent')),
  ]);
  const zip = await JSZip.loadAsync(new Uint8Array(bytes));
  expect(
    Object.keys(zip.files).filter((path) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path),
    ),
  ).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('export caches do not add undo steps after a public cross-slide batch', async ({
  page,
}) => {
  await page.goto('/test/public-viewer');
  await expect(
    page.getByRole('button', { name: 'Go to slide 2' }),
  ).toBeVisible();
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.viewerCall(method, args), {
      method,
      args,
    });
  const initial = await call('getSlides');
  const targets = initial.map((slide, index) => ({
    slideId: slide.id,
    elementId: slide.elements.find((el) => el.type === 'text').id,
    patch: { x: 20 + index },
  }));
  await call('updateElements', targets, { label: 'Cross-slide batch' });
  await call('getContent');
  await call('goTo', 1);
  await call('undo');
  const undone = await call('getSlides');
  for (const [index, target] of targets.entries())
    expect(
      undone[index].elements.find((el) => el.id === target.elementId).x,
    ).toBe(initial[index].elements.find((el) => el.id === target.elementId).x);
  expect(await call('canUndo')).toBe(false);
  expect(await call('canRedo')).toBe(true);
  await call('redo');
  const redone = await call('getSlides');
  for (const [index, target] of targets.entries())
    expect(
      redone[index].elements.find((el) => el.id === target.elementId).x,
    ).toBe(target.patch.x);
});

for (const destination of ['existing slide', 'new slide']) {
  test(`batch undo survives serialization of new content: ${destination}`, async ({
    page,
  }) => {
    await page.goto('/test/public-viewer');
    await expect(
      page.getByRole('button', { name: 'Go to slide 2' }),
    ).toBeVisible();
    const call = (method, ...args) =>
      page.evaluate(({ method, args }) => window.viewerCall(method, args), {
        method,
        args,
      });
    if (destination === 'new slide') await call('addSlide', 2);
    const slideIndex = await call('getActiveSlideIndex');
    const elementId = await call('addElement', {
      type: 'text',
      id: 'fresh-input',
      text: 'Fresh target',
      x: 100,
      y: 100,
      width: 300,
      height: 80,
    });
    const before = await call('getSlides');
    const other = before[1].elements.find((element) => element.type === 'text');
    await call(
      'updateElements',
      [
        { slideId: before[slideIndex].id, elementId, patch: { x: 170 } },
        { slideId: before[1].id, elementId: other.id, patch: { x: 220 } },
      ],
      { label: 'Batch with new content' },
    );
    await call('getContent');
    await call('goTo', 1);
    await call('undo');
    const undone = await call('getSlides');
    expect(
      undone[slideIndex].elements.find((element) => element.id === elementId).x,
    ).toBe(100);
    expect(
      undone[1].elements.find((element) => element.id === other.id).x,
    ).toBe(other.x);
    await call('undo');
    expect(
      (await call('getSlides'))[slideIndex].elements.some(
        (element) => element.id === elementId,
      ),
    ).toBe(false);
    if (destination === 'new slide') {
      await call('undo');
      expect(await call('getSlideCount')).toBe(2);
      await call('redo');
    }
    await call('redo');
    await call('redo');
    const redone = await call('getSlides');
    expect(
      redone[slideIndex].elements.find((element) => element.id === elementId).x,
    ).toBe(170);
    expect(
      redone[1].elements.find((element) => element.id === other.id).x,
    ).toBe(220);
  });
}
