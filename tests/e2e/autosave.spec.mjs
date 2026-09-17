import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function setup(page, fileName = 'synthetic.pptx') {
  // Browser contexts are isolated, but the test host retains session leases.
  const namespace = randomUUID();
  const sessionKey = (name = 'autosave') => `${namespace}-${name}`;
  const fixture = [...(await readFile('.cache/synthetic.pptx'))];
  await page.addInitScript(
    ({ initial, name }) => {
      window.__diskWrites = 0;
      window.showOpenFilePicker = async () => [
        {
          name,
          getFile: async () => new File([new Uint8Array(initial)], name),
          createWritable: async () => {
            window.__diskWrites += 1;
            throw new Error('Recovery must not write to disk');
          },
        },
      ];
    },
    { initial: fixture, name: fileName },
  );
  page.on('dialog', (dialog) => dialog.accept());
  const editor = page.frameLocator('iframe');
  const open = async (session = 'autosave') => {
    await page.goto(`/test/panel?session=${sessionKey(session)}`);
    await expect(
      editor.locator('.pptx-connection[data-state="connected"]'),
    ).toBeAttached({ timeout: 30_000 });
    await editor
      .getByRole('button', { name: '打开 PPTX', exact: true })
      .first()
      .click();
    await expect(
      editor.getByRole('switch', { name: '切换自动保存' }),
    ).toBeEnabled();
  };
  const call = async (name, args = {}, sessionId = 'autosave') => {
    const response = await page.request.post('/test/command', {
      data: { name, args, sessionId: sessionKey(sessionId) },
    });
    const value = await response.json();
    expect(response.ok(), JSON.stringify(value)).toBe(true);
    return value;
  };
  const rename = async (text, sessionId = 'autosave') => {
    const state = await call('read_pptx', {}, sessionId);
    const title = state.slides[0].elements.find((element) =>
      element.text?.startsWith('Project'),
    );
    await call(
      'edit_pptx',
      {
        documentId: state.documentId,
        version: state.version,
        slideIndex: 0,
        elementId: title.id,
        summary: 'Recovery regression',
        patch: { text },
      },
      sessionId,
    );
  };
  return { editor, open, call, rename, sessionKey };
}

test('autosave assigns new slide archive IDs without expiring a pending Agent edit', async ({
  page,
}) => {
  const { editor, open, call } = await setup(page);
  await open();
  await editor.getByRole('switch', { name: '切换自动保存' }).click();
  const read = () => call('read_pptx');
  const base = (state) => ({
    documentId: state.documentId,
    version: state.version,
  });
  const operate = async (action) =>
    call('operate_pptx', {
      action: {
        ...base(await read()),
        summary: 'Autosave version regression',
        ...action,
      },
    });
  await operate({ operation: 'duplicate-slide', slideIndex: 0 });
  await operate({ operation: 'duplicate-slide', slideIndex: 0 });
  await call('add_pptx_slide', {
    ...base(await read()),
    summary: 'Add a blank slide',
  });
  await operate({ operation: 'navigate', slideIndex: 2 });
  const duplicate = await read();
  const square = duplicate.slides[2].elements.find(
    (el) => el.type === 'shape' && el.width === el.height,
  );
  expect(square).toBeDefined();
  await operate({
    operation: 'delete-elements',
    slideIndex: 2,
    elementIds: [square.id],
  });
  await editor.getByRole('switch', { name: '切换自动保存' }).click();
  const beforeSnapshot = await read();
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await read()).slides.map((slide) => slide.id), {
      timeout: 15_000,
    })
    .not.toEqual(beforeSnapshot.slides.map((slide) => slide.id));
  const afterSnapshot = await read();
  expect(afterSnapshot.slides[1].id).not.toBe(beforeSnapshot.slides[1].id);
  expect(afterSnapshot.slides[4].id).not.toBe(beforeSnapshot.slides[4].id);
  expect(afterSnapshot.version).toBe(beforeSnapshot.version);
  await call('add_pptx_text', {
    ...base(beforeSnapshot),
    slideIndex: 2,
    summary: 'Add centered text after autosave',
    text: 'Hello after autosave',
    x: 470,
    y: 300,
    width: 480,
    height: 64,
    textStyle: { align: 'center' },
  });
  const added = await read();
  expect(
    added.slides[2].elements.filter((el) => el.text === 'Hello after autosave'),
  ).toHaveLength(1);
  expect(added.slides[2].elements.some((el) => el.id === square.id)).toBe(
    false,
  );
  expect(added.slides).toHaveLength(5);
  await operate({ operation: 'undo' });
  expect(
    (await read()).slides[2].elements.some(
      (el) => el.text === 'Hello after autosave',
    ),
  ).toBe(false);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  expect(await editor.locator('body').evaluate(() => window.__diskWrites)).toBe(
    0,
  );
});

test('autosave of a newly inserted table keeps a pending edit valid', async ({
  page,
}) => {
  const { editor, open, call } = await setup(page);
  await open('autosave-table');
  const invoke = (name, args = {}) => call(name, args, 'autosave-table');
  await editor.getByRole('switch', { name: '切换自动保存' }).click();
  const initial = await invoke('read_pptx');
  const inserted = await invoke('operate_pptx', {
    action: {
      documentId: initial.documentId,
      version: initial.version,
      summary: 'Insert a table before recovery serialization',
      operation: 'add-table',
      slideIndex: 0,
      x: 100,
      y: 200,
      width: 400,
      height: 160,
      table: {
        rows: [
          ['Item', 'Score'],
          ['Alpha', '10'],
        ],
      },
    },
  });
  await editor.getByRole('switch', { name: '切换自动保存' }).click();
  const before = await invoke('read_pptx');
  // Allow the native debounced snapshot to include the newly inserted table.
  await page.waitForTimeout(3000);
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect((await invoke('read_pptx')).version).toBe(before.version);
  await invoke('operate_pptx', {
    action: {
      documentId: before.documentId,
      version: before.version,
      summary: 'Edit the table after autosave',
      operation: 'update-table',
      slideIndex: 0,
      elementId: inserted.elementId,
      update: { kind: 'cells', cells: [{ row: 1, column: 1, text: '42' }] },
    },
  });
  const updated = await invoke('read_pptx');
  expect(
    updated.slides[0].elements.find((el) => el.id === inserted.elementId).table
      .rows[1].cells[1].text,
  ).toBe('42');
});

test('native autosave recovers Agent and manual edits, respects its toggle and isolates conversations', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { editor, open, call, rename, sessionKey } = await setup(page);
  await open();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).toBeChecked();
  await rename('Project Agent draft');
  const edited = await call('read_pptx');
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const snapshotted = await call('read_pptx');
  expect(snapshotted.version).toBe(edited.version);
  expect(await editor.locator('body').evaluate(() => window.__diskWrites)).toBe(
    0,
  );

  // A second edit while already dirty must replace the recovery snapshot.
  await editor
    .getByText('Project Agent draft', { exact: true })
    .last()
    .dblclick();
  await editor.locator('[contenteditable="true"]').fill('Project Manual draft');
  await editor.getByRole('tab', { name: '开始', exact: true }).click();
  await page.waitForTimeout(3000);
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible();
  await editor.getByRole('switch', { name: '切换自动保存' }).click();
  await expect(
    editor.getByRole('switch', { name: '切换自动保存' }),
  ).not.toBeChecked();
  await rename('Project Not snapshotted');
  await page.waitForTimeout(3000);

  await open('another-conversation');
  await expect(
    editor.getByRole('dialog', { name: '恢复未保存的更改？' }),
  ).toHaveCount(0);
  expect(
    (
      await call('read_pptx', {}, 'another-conversation')
    ).slides[0].elements.some((element) => element.text === 'Project Atlas'),
  ).toBe(true);

  await open();
  const recovery = editor.getByRole('dialog', { name: '恢复未保存的更改？' });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('synthetic.pptx');
  await expect(recovery).not.toContainText('dsh-pptx/');
  const blocked = await page.request.post('/test/command', {
    data: { name: 'read_pptx', sessionId: sessionKey() },
  });
  expect((await blocked.json()).error).toContain(
    'Resolve the open editor dialog',
  );
  await recovery.getByRole('button', { name: '恢复', exact: true }).click();
  await expect
    .poll(async () =>
      (await call('read_pptx')).slides[0].elements.some(
        (element) => element.text === 'Project Manual draft',
      ),
    )
    .toBe(true);
  expect(await editor.locator('body').evaluate(() => window.__diskWrites)).toBe(
    0,
  );

  // A recovered document must remain editable under a fresh session version.
  await rename('Project After recovery');
  await expect(
    editor.getByText('Project After recovery', { exact: true }).last(),
  ).toBeVisible();

  // Restoring is not a file save. Even with AutoSave off, the last completed
  // snapshot remains available on a subsequent reload.
  await open();
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(
    editor.getByText('Project Manual draft', { exact: true }).last(),
  ).toBeVisible();
  expect(
    (await call('read_pptx')).slides[0].elements.some(
      (element) => element.text === 'Project Manual draft',
    ),
  ).toBe(true);
});

test('recovery filenames wrap inside narrow dialogs in both host languages', async ({
  page,
}) => {
  const fileName = `${'QuarterlyReport'.repeat(10)}年度报告.pptx`;
  const { editor, open, rename, call } = await setup(page, fileName);
  await open();
  await rename('Project Long filename');
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible();
  await open();
  const recovery = editor.getByRole('dialog', {
    name: /^(恢复未保存的更改？|Recover unsaved changes\?)$/,
  });
  await expect(recovery).toContainText(fileName);
  await expect(recovery).not.toContainText('dsh-pptx/');
  for (const language of ['DSH 中文', 'DSH English']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await expect(recovery).toHaveAccessibleName(
      language === 'DSH 中文'
        ? '恢复未保存的更改？'
        : 'Recover unsaved changes?',
    );
    for (const viewport of [
      { width: 1600, height: 1000 },
      { width: 360, height: 640 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await recovery.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return {
          overflow: dialog.scrollWidth - dialog.clientWidth,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
      await recovery.getByRole('button').last().scrollIntoViewIfNeeded();
      await expect(recovery.getByRole('button').last()).toBeInViewport();
    }
  }
  await recovery.getByRole('button', { name: 'Restore', exact: true }).focus();
  await recovery
    .getByRole('button', { name: 'Restore', exact: true })
    .press('Enter');
  await expect(recovery).toHaveCount(0);
  // Leave the viewer's narrow-screen slide drawer before issuing an Agent command.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(
    editor.getByText('Project Long filename', { exact: true }).last(),
  ).toBeVisible();
  await expect(editor.getByRole('dialog')).toHaveCount(0);
  expect(
    (await call('read_pptx')).slides[0].elements.some(
      (element) => element.text === 'Project Long filename',
    ),
  ).toBe(true);
});

test('a recovered added slide survives consecutive reloads until its snapshot is discarded', async ({
  page,
}) => {
  const { editor, open, call } = await setup(page);
  await open();
  let state = await call('read_pptx');
  await call('add_pptx_slide', {
    documentId: state.documentId,
    version: state.version,
    afterSlideIndex: 1,
    summary: 'Recovery slide',
  });
  state = await call('read_pptx');
  await call('add_pptx_text', {
    documentId: state.documentId,
    version: state.version,
    slideIndex: 2,
    text: 'Recovered third slide',
    x: 40,
    y: 40,
    width: 600,
    height: 80,
    summary: 'Recovery title',
  });
  // The existing saved label may describe the snapshot before this last edit.
  await page.waitForTimeout(3000);
  await expect(editor.getByText('已保存 刚刚', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const recovery = editor.getByRole('dialog', { name: '恢复未保存的更改？' });
  for (let reload = 0; reload < 3; reload += 1) {
    await open();
    await expect(recovery).toBeVisible();
    await recovery.getByRole('button', { name: '恢复', exact: true }).click();
    await expect(
      editor.getByRole('button', { name: 'Go to slide 3', exact: true }),
    ).toBeVisible();
    state = await call('read_pptx');
    expect(state.slides).toHaveLength(3);
    expect(
      state.slides[2].elements.some(
        (element) => element.text === 'Recovered third slide',
      ),
    ).toBe(true);
  }
  await open();
  // Hold IndexedDB's completion notification to exercise a slow discard.
  await editor.locator('body').evaluate(() => {
    const deleting = new WeakSet();
    const remove = IDBObjectStore.prototype.delete;
    const complete = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      'oncomplete',
    );
    IDBObjectStore.prototype.delete = function (...args) {
      deleting.add(this.transaction);
      return remove.apply(this, args);
    };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...complete,
      set(handler) {
        complete.set.call(this, function (event) {
          const finish = () => handler.call(this, event);
          if (deleting.has(this)) window.__completeDiscard = finish;
          else finish();
        });
      },
    });
  });
  await recovery.getByRole('button', { name: '放弃', exact: true }).click();
  await expect(recovery).toHaveAttribute('aria-busy', 'true');
  await expect(
    recovery.getByRole('button', { name: '放弃', exact: true }),
  ).toBeDisabled();
  await expect(
    recovery.getByRole('button', { name: '恢复', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      editor.locator('body').evaluate(() => typeof window.__completeDiscard),
    )
    .toBe('function');
  await editor.locator('body').evaluate(() => window.__completeDiscard());
  await expect(recovery).toHaveCount(0);
  await open();
  await expect(recovery).toHaveCount(0);
  expect((await call('read_pptx')).slides).toHaveLength(2);
});

test('restoring a newer conversation does not suppress an older conversation snapshot', async ({
  page,
}) => {
  const { editor, open, rename } = await setup(page);
  await open();
  await rename('Project Older draft');
  await page.waitForTimeout(3000);
  await open('newer');
  await rename('Project Newer draft', 'newer');
  await page.waitForTimeout(3000);
  await open('newer');
  const recovery = editor.getByRole('dialog', { name: '恢复未保存的更改？' });
  await recovery.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(
    editor.getByText('Project Newer draft', { exact: true }).last(),
  ).toBeVisible();
  await open();
  await recovery.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(
    editor.getByText('Project Older draft', { exact: true }).last(),
  ).toBeVisible();
});

test('native autosave storage failure keeps the live editor dirty and editable', async ({
  page,
}) => {
  const { editor, open, rename } = await setup(page);
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    };
  });
  await open();
  await rename('Project Cache failure');
  await expect(
    editor.getByText('自动保存错误', { exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  expect(await editor.locator('body').evaluate(() => window.__diskWrites)).toBe(
    0,
  );
  await rename('Project Still editable');
  await expect(
    editor.getByText('Project Still editable', { exact: true }).last(),
  ).toBeVisible();
});
