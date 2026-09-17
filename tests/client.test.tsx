// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import {
  CLOSE_EDITOR,
  previousEditorRelease,
  type CloseRequest,
} from '../src/editor-lifecycle.js';
import { attachPanel } from '../src/panel-lifetime.js';
import { apply, PptxPanel, type PanelProps } from '../src/client.js';
import { confirmAction } from '../src/confirm-action.js';
import { isPanelDismissed } from '../src/panel-dismissal.js';

vi.mock('../src/confirm-action.js', () => ({ confirmAction: vi.fn() }));

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  Object.defineProperty(Element.prototype, 'moveBefore', {
    configurable: true,
    value(this: Element, node: Node) {
      this.append(node);
    },
  });
});

it.each([false, true])(
  'keeps a closing frame alive and gates its replacement until cleanup (reject=%s)',
  async (reject) => {
    const host = document.createElement('div');
    document.body.append(host);
    const first = new AbortController();
    const session = `release-${String(reject)}`;
    const released = Promise.withResolvers<undefined>();
    attachPanel(host, session, first.signal);
    const oldFrame = host.querySelector('iframe');
    oldFrame?.addEventListener(CLOSE_EDITOR, (event) => {
      (event as CustomEvent<CloseRequest>).detail.respond({
        dirty: false,
        fileName: '',
        released: released.promise,
      });
    });
    first.abort();
    expect(oldFrame?.isConnected).toBe(true);
    expect(oldFrame?.parentElement?.hidden).toBe(true);
    const next = new AbortController();
    attachPanel(host, session, next.signal);
    const frame = host.querySelector('iframe');
    expect(frame).not.toBe(oldFrame);
    const barrier = previousEditorRelease(frame);
    expect(barrier).toBeDefined();
    if (reject) released.reject(new Error('Cleanup failed'));
    else released.resolve(undefined);
    await barrier;
    expect(oldFrame?.isConnected).toBe(false);
    expect(frame?.isConnected).toBe(true);
    frame?.addEventListener(CLOSE_EDITOR, (event) => {
      (event as CustomEvent<CloseRequest>).detail.respond({
        dirty: false,
        fileName: '',
      });
    });
    next.abort();
    expect(frame?.isConnected).toBe(false);
    host.remove();
  },
);
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Reflect.deleteProperty(Element.prototype, 'moveBefore');
});
it('registers a session-bound editor without a start-page guide, with scoped cleanup', () => {
  const controller = new AbortController();
  const useTabInfo = () =>
    ({ tab: { id: 'tab', signal: controller.signal } }) as ReturnType<
      PanelProps['useTabInfo']
    >;
  const view = render(
    <PptxPanel sessionId="session/one" useTabInfo={useTabInfo} />,
  );
  expect(
    view.getByTitle('PPTX editor / 演示文稿编辑器').getAttribute('src'),
  ).toBe('/dsh-pptx/#session%2Fone');
  const frame = view.getByTitle('PPTX editor / 演示文稿编辑器');
  frame.addEventListener(CLOSE_EDITOR, (event) => {
    (event as CustomEvent<CloseRequest>).detail.respond({
      dirty: false,
      fileName: 'test.pptx',
    });
  });
  view.unmount();
  expect(isPanelDismissed(document, 'session/one')).toBe(false);
  const next = render(
    <PptxPanel sessionId="session/one" useTabInfo={useTabInfo} />,
  );
  expect(next.getByTitle('PPTX editor / 演示文稿编辑器')).toBe(frame);
  expect(next.getByTitle('PPTX editor / 演示文稿编辑器')).toBeDefined();
  // Closing parks a loaded editor; reopening must reuse its file handle and state.
  act(() => {
    controller.abort();
  });
  expect(next.container.querySelector('iframe')).toBeNull();
  expect(frame.isConnected).toBe(true);
  expect(isPanelDismissed(document, 'session/one')).toBe(true);
  const reopened = new AbortController();
  next.rerender(
    <PptxPanel
      sessionId="session/one"
      useTabInfo={() =>
        ({ tab: { id: 'reopened', signal: reopened.signal } }) as ReturnType<
          PanelProps['useTabInfo']
        >
      }
    />,
  );
  expect(next.getByTitle('PPTX editor / 演示文稿编辑器')).toBe(frame);
  expect(isPanelDismissed(document, 'session/one')).toBe(false);
  act(() => {
    reopened.abort();
  });
  const register = vi.fn(() => () => {});
  const typeRegister = vi.fn(
    (spec: { title: () => string; kind: string; guide?: unknown }) => {
      expect(spec.title()).toBe('PPTX');
      expect(spec.kind).toBe('pptx-editor');
      expect(spec.guide).toBeUndefined();
      return () => {};
    },
  );
  const ctx = {
    sessions: { list: { getSnapshot: () => ({}), subscribe: () => () => {} } },
    sidebarRightTabs: { register: typeRegister },
    slots: {
      inject: (_seat: string, start: () => unknown) => start(),
      register,
    },
    effect: (start: () => unknown) => start(),
  };
  apply(ctx as unknown as Context);
  expect(typeRegister).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledWith(
    { name: 'sidebar.right.pane.tab', key: 'dsh-pptx-viewer' },
    PptxPanel,
  );
});

it('reports unsupported browsers without opening a disposable editor', () => {
  Reflect.deleteProperty(Element.prototype, 'moveBefore');
  const controller = new AbortController();
  const useTabInfo = () =>
    ({ tab: { id: 'old', signal: controller.signal } }) as ReturnType<
      PanelProps['useTabInfo']
    >;
  const view = render(<PptxPanel sessionId="s" useTabInfo={useTabInfo} />);
  expect(view.getByRole('alert').textContent).toContain('Chrome');
  expect(view.queryByTitle('PPTX editor / 演示文稿编辑器')).toBeNull();
  controller.abort();
});

it('binds retained frames to their original session and ignores disposed records', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const controller = new AbortController();
  const detach = attachPanel(host, 'one', controller.signal);
  expect(() => attachPanel(host, 'one', new AbortController().signal)).toThrow(
    'already',
  );
  host.querySelector('iframe')?.addEventListener(CLOSE_EDITOR, (event) => {
    (event as CustomEvent<CloseRequest>).detail.respond({
      dirty: false,
      fileName: 'test.pptx',
    });
  });
  controller.abort();
  detach();
  attachPanel(host, 'one', controller.signal)();
  expect(host.childElementCount).toBe(0);
  host.remove();
});

it('adopts the same editor and ownership after a client module reload', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const controller = new AbortController();
  const detach = attachPanel(host, 'module-reload', controller.signal);
  const frame = host.querySelector('iframe');
  frame?.addEventListener(CLOSE_EDITOR, (event) => {
    (event as CustomEvent<CloseRequest>).detail.respond({
      dirty: false,
      fileName: 'test.pptx',
    });
  });
  detach();
  vi.resetModules();
  const reloaded = await import('../src/panel-lifetime.js');
  reloaded.attachPanel(host, 'module-reload', controller.signal);
  expect(host.querySelector('iframe')).toBe(frame);
  expect(() =>
    reloaded.attachPanel(host, 'module-reload', new AbortController().signal),
  ).toThrow('already');
  controller.abort();
  expect(frame?.isConnected).toBe(true);
  host.remove();
});

it('retains closed unsaved editors for recovery, native reopening, or explicit discard', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const first = new AbortController();
  attachPanel(host, 'recover', first.signal);
  const frame = host.querySelector('iframe');
  first.abort();
  const restore = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === '继续编辑',
  );
  if (!restore) throw new Error('Recovery missing');
  restore.click();
  expect(frame?.parentElement?.hidden).toBe(false);
  const close = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === '返回对话',
  );
  if (!close) throw new Error('Close missing');
  close.click();
  const next = new AbortController();
  attachPanel(host, 'recover', next.signal);
  expect(host.querySelector('iframe')).toBe(frame);
  next.abort();
  const discard = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === '丢弃修改',
  );
  if (!discard) throw new Error('Discard missing');
  const confirm = vi.mocked(confirmAction).mockResolvedValue(false);
  discard.click();
  await vi.waitFor(() => {
    expect(discard.disabled).toBe(false);
  });
  expect(frame?.isConnected).toBe(true);
  confirm.mockResolvedValue(true);
  discard.click();
  await vi.waitFor(() => {
    expect(frame?.isConnected).toBe(false);
  });
  confirm.mockReset();
  host.remove();
});

it('keeps a legacy owner on its old UI until reopening, then upgrades and waits for release', async () => {
  const host = document.createElement('div');
  const frame = document.createElement('iframe');
  const parking = document.createElement('div');
  parking.hidden = true;
  const first = new AbortController();
  const entry = {
    frame,
    parking,
    notice: document.createElement('div'),
    overlay: document.createElement('div'),
    owner: first.signal,
  };
  document.body.append(host, parking, entry.notice, entry.overlay);
  host.append(frame);
  const registry = Reflect.get(
    document,
    Symbol.for('dsh-pptx-viewer.panel-registry.v1'),
  ) as Map<string, typeof entry>;
  registry.set('legacy-recovery', entry);
  // The old module's still-live callback replaces its notice's contents on close.
  first.signal.addEventListener('abort', () => {
    parking.append(frame);
    entry.notice.replaceChildren(document.createTextNode('Legacy recovery'));
  });
  attachPanel(host, 'legacy-recovery', first.signal);
  expect(document.querySelector('.pptx-panel-recovery')).toBeNull();
  first.abort();
  expect(entry.notice.textContent).toBe('Legacy recovery');

  const release = Promise.withResolvers<undefined>();
  frame.addEventListener(CLOSE_EDITOR, (event) => {
    (event as CustomEvent<CloseRequest>).detail.respond({
      dirty: true,
      fileName: 'replacement.pptx',
      released: release.promise,
    });
  });
  const next = new AbortController();
  attachPanel(host, 'legacy-recovery', next.signal);
  expect(host.querySelector('iframe')).toBe(frame);
  next.abort();
  expect(entry.notice.textContent).toContain('replacement.pptx');
  expect(entry.notice.textContent).not.toContain('Legacy recovery');
  const buttons = () => Array.from(entry.notice.querySelectorAll('button'));
  const restore = buttons().find((button) => button.textContent === '继续编辑');
  if (!restore) throw new Error('Recovery action missing');
  restore.click();
  expect(frame.parentElement).toBe(entry.overlay);
  const close = entry.overlay.querySelector('button');
  if (!close) throw new Error('Recovery close action missing');
  close.click();
  expect(restore.isConnected).toBe(true);
  const discard = buttons().find((button) => button.textContent === '丢弃修改');
  if (!discard) throw new Error('Discard action missing');
  vi.mocked(confirmAction).mockResolvedValue(true);
  discard.click();
  await vi.waitFor(() => {
    expect(document.querySelector('.pptx-panel-recovery')).toBeNull();
  });
  expect(frame.isConnected).toBe(true);
  release.resolve(undefined);
  await vi.waitFor(() => {
    expect(frame.isConnected).toBe(false);
  });
  vi.mocked(confirmAction).mockReset();
  host.remove();
});
