import { operationFixture } from './operation-fixture.js';
import { operationSchema } from '../src/protocol.js';
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PowerPointViewerHandle } from 'pptx-react-viewer';
import { writeStoredViewerPrefs } from 'pptx-react-viewer';
import type { EditorCommand } from '../src/protocol.js';
import {
  inspectClosingEditor,
  deferEditorConnection,
  resumeEditor,
} from '../src/editor-lifecycle.js';
import { App } from '../src/editor/App.js';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { publishAttachment } from '../src/attachment-intake.js';
import type { OpenedDocument } from '../src/editor/file.js';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';

const mock = vi.hoisted(() => ({
  confirm: vi.fn(),
  open: vi.fn<() => Promise<OpenedDocument>>(),
  chat: vi.fn<() => Promise<OpenedDocument>>(),
  connect: vi.fn(),
  editor: {} as PowerPointViewerHandle,
  execute: undefined as ((command: EditorCommand) => unknown) | undefined,
  signal: undefined as AbortSignal | undefined,
  count: 1,
}));
vi.mock('../src/confirm-action.js', () => ({ confirmAction: mock.confirm }));
vi.mock('../src/editor/file.js', () => ({ openDocument: mock.open }));
vi.mock('../src/editor/transport.js', () => ({ connectEditor: mock.connect }));
vi.mock('../src/editor/chat-file.js', () => ({ loadChatFile: mock.chat }));
vi.mock('../src/editor/recovery-key.js', () => ({
  recoveryKey: () => Promise.resolve('test-recovery/synthetic.pptx'),
}));
vi.mock('pptx-react-viewer', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    readStoredViewerPrefs: () => ({}),
    writeStoredViewerPrefs: vi.fn(),
    defaultCssVars: () => ({ '--pptx-background': '#0f1113' }),
    resolveThemeCatalogEntry: vi.fn(() => ({})),
    themeToCssVars: vi.fn(() => ({})),
    PowerPointViewer: ({
      ref,
      onDirtyChange,
      onActiveSlideChange,
      onOpenFile,
      onThemeChange,
    }: {
      ref: React.Ref<PowerPointViewerHandle>;
      onDirtyChange: () => void;
      onActiveSlideChange: () => void;
      onOpenFile: () => void;
      onThemeChange: (key: string) => void;
    }) => {
      useImperativeHandle(ref, () => mock.editor);
      return (
        <div data-testid="viewer">
          <input aria-label="Inline text" onChange={onDirtyChange} />
          <button onClick={onActiveSlideChange}>Navigate slide</button>
          <button onClick={onOpenFile}>Viewer open</button>
          <button
            onClick={() => {
              onThemeChange('vermilionLight');
            }}
          >
            Viewer light theme
          </button>
        </div>
      );
    },
  };
});

it.each([false, true])(
  'waits for a previous frame cleanup before connecting (closed early=%s)',
  async (closedEarly) => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
    const released = Promise.withResolvers<undefined>();
    deferEditorConnection(frame, released.promise);
    const view = render(<App sessionId="waiting" />);
    expect(mock.connect).not.toHaveBeenCalled();
    if (closedEarly)
      act(() => {
        inspectClosingEditor(frame);
      });
    await act(async () => {
      await Promise.resolve();
      released.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.connect).toHaveBeenCalledTimes(closedEarly ? 0 : 1);
    let closed: Promise<void> | undefined;
    act(() => {
      closed = inspectClosingEditor(frame).released;
    });
    await closed;
    expect(mock.signal?.aborted).toBe(true);
    view.unmount();
    frame.remove();
  },
);

it('keeps an editor closed during script loading paused until its tab resumes', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  inspectClosingEditor(frame);
  const view = render(<App sessionId="closed-before-start" />);
  expect(mock.connect).not.toHaveBeenCalled();
  expect(screen.getByText('恢复视图')).toBeDefined();
  act(() => {
    resumeEditor(frame);
  });
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(screen.queryByText('Agent 已连接')).toBeNull();
  await act(async () => {
    await Promise.resolve();
    await inspectClosingEditor(frame).released;
  });
  view.unmount();
  frame.remove();
});

beforeEach(async () => {
  document.documentElement.lang = 'zh-CN';
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: 'en',
    resources: {
      en: { translation: { test: 'Test' } },
      'zh-CN': { translation: { test: '测试' } },
    },
  });
  mock.confirm.mockReset().mockResolvedValue(false);
  vi.useFakeTimers();
  mock.count = 1;
  const element = {
    type: 'text' as const,
    id: 'title',
    x: 1,
    y: 2,
    width: 100,
    height: 30,
    text: 'Before',
    textSegments: [],
  };
  const slides: ReturnType<PowerPointViewerHandle['getSlides']>[number][] = [
    { id: 'slide', rId: 'rId1', slideNumber: 1, elements: [element] },
  ];
  let activeSlideIndex = 0;
  mock.editor = {
    getSlides: () => slides,
    getSelectedElementIds: () => [],
    getSlideCount: () => mock.count,
    getActiveSlideIndex: () => activeSlideIndex,
    canUndo: () => false,
    canRedo: () => false,
    getMode: () => 'edit',
    addSlide: vi.fn((afterIndex: number) => {
      activeSlideIndex = afterIndex + 1;
      slides.splice(activeSlideIndex, 0, {
        id: 'new-slide',
        rId: 'rId2',
        slideNumber: 2,
        elements: [],
      });
      mock.count = slides.length;
    }),
    addElement: vi.fn(
      (value: Parameters<PowerPointViewerHandle['addElement']>[0]) => {
        slides[activeSlideIndex]?.elements.push({
          ...value,
          id: 'inserted-text',
        });
        return 'inserted-text';
      },
    ),
    updateElement: vi.fn((_id: string, patch: object) => {
      Object.assign(element, patch);
    }),
    getContent: vi.fn(() => Promise.resolve(new Uint8Array([1, 2]))),
  } as unknown as PowerPointViewerHandle;
  mock.open.mockReset().mockResolvedValue({
    file: {
      name: 'synthetic.pptx',
      read: () => Promise.resolve(new Uint8Array([1, 2])),
      write: vi.fn().mockResolvedValue(undefined),
    },
    bytes: new Uint8Array([1, 2]),
  });
  mock.chat.mockReset().mockImplementation(() => mock.open());
  mock.connect
    .mockReset()
    .mockImplementation(
      (
        _id: string,
        execute: (command: EditorCommand) => unknown,
        signal: AbortSignal,
        connected: () => void,
      ) => {
        mock.execute = execute;
        mock.signal = signal;
        connected();
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
      },
    );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function command(command: EditorCommand): unknown {
  if (!mock.execute) throw new Error('Transport not connected');
  return mock.execute(command);
}

it('waits for the native panel to be visible before acknowledging a conversational reopen', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const rects = vi.spyOn(frame, 'getBoundingClientRect');
  Object.defineProperty(frame, 'checkVisibility', {
    configurable: true,
    value: () => true,
  });
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
    1000,
  );
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(
    1000,
  );
  const view = render(<App sessionId="visible-reopen" />);
  await open();
  expect(() => command({ kind: 'read', requireVisible: true })).toThrow(
    'not visible',
  );
  rects.mockReturnValue({
    width: 100,
    height: 100,
    top: 0,
    left: 0,
    bottom: 99,
    right: 99,
  } as DOMRect);
  let result: unknown;
  act(() => {
    result = command({ kind: 'read', requireVisible: true });
  });
  expect(result).toMatchObject({
    fileName: 'synthetic.pptx',
    preview: { status: 'ready' },
  });
  view.unmount();
  frame.remove();
});
async function open() {
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getAllByText('打开 PPTX')[0] as HTMLElement);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
  });
}
function read() {
  return command({ kind: 'read' }) as { documentId: string; version: number };
}

it('awaits batch edits through the live ref and reports async failures without stale-error toasts', async () => {
  render(<App sessionId="batch" />);
  await open();
  mock.editor.updateElements = vi.fn<PowerPointViewerHandle['updateElements']>(
    async (updates) => {
      await Promise.resolve();
      for (const update of updates)
        mock.editor.updateElement(update.elementId, update.patch);
    },
  );
  const batch = () => ({
    kind: 'edit-batch' as const,
    change: {
      documentId: read().documentId,
      version: read().version,
      summary: 'Batch',
      edits: [
        { slideIndex: 0, elementId: 'title', patch: { text: 'Batch title' } },
      ],
    },
  });
  const first = batch();
  await act(async () => {
    expect(await command(first)).toMatchObject({
      status: 'applied',
      undoSteps: 1,
    });
  });
  expect(mock.editor.updateElements).toHaveBeenCalledOnce();
  await act(async () => {
    await expect(command(first)).rejects.toThrow('Stale');
  });
  expect(screen.queryByRole('alert')).toBeNull();
  vi.mocked(mock.editor.updateElements).mockRejectedValueOnce(
    new Error('Batch unavailable'),
  );
  await act(async () => {
    await expect(command(batch())).rejects.toThrow('Batch unavailable');
  });
  expect(screen.getByRole('alert').textContent).toContain('Batch unavailable');
});

it('loads an admitted chat attachment and fences old document commands', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="chat-save" />);
  const result = await mock.open();
  mock.chat.mockResolvedValue(result);
  const intent = {
    key: '1:file',
    files: [
      {
        attachmentId: 'file',
        name: 'test.pptx',
        bytes: 2,
      } as FileAttachmentRef,
    ],
  };
  await act(async () => {
    await Promise.resolve();
    publishAttachment(document, 'chat-save', intent);
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(mock.chat).toHaveBeenCalledOnce();
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(() => command({ kind: 'read', attachmentKey: 'old' })).toThrow(
    'not loaded',
  );
  expect(command({ kind: 'read', attachmentKey: intent.key })).toMatchObject({
    fileName: 'synthetic.pptx',
  });
  expect(screen.queryByRole('button', { name: '保存到本机…' })).toBeNull();
  expect(result.file.write).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
    publishAttachment(document, 'chat-save', { ...intent });
  });
  expect(mock.chat).toHaveBeenCalledOnce();
  view.unmount();
  frame.remove();
});

it('keeps the current document after intake failure or cancellation and permits an explicit retry', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="chat-retry" />);
  await open();
  edit();
  const oldId = read().documentId;
  const intent = {
    key: '2:new',
    files: [
      { attachmentId: 'new', name: 'test.pptx', bytes: 2 } as FileAttachmentRef,
    ],
  };
  await act(async () => {
    await Promise.resolve();
    publishAttachment(document, 'chat-retry', intent);
  });
  expect(mock.chat).not.toHaveBeenCalled();
  expect(read().documentId).toBe(oldId);
  expect(screen.getByRole('alert').textContent).toContain('已保留当前文稿');
  mock.confirm.mockResolvedValue(true);
  mock.chat.mockRejectedValueOnce(new Error('Temporary attachment failure'));
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByText('重试打开附件'));
  });
  expect(read().documentId).toBe(oldId);
  expect(screen.getByRole('alert').textContent).toContain('Temporary');
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByText('重试打开附件'));
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(read().documentId).not.toBe(oldId);
  await act(async () => {
    await Promise.resolve();
    publishAttachment(document, 'chat-retry', {
      key: 'many',
      files: [...intent.files, ...intent.files],
    });
  });
  expect(screen.getByRole('alert').textContent).toContain('一次发送一份');
  view.unmount();
  frame.remove();
});

it('prevents manual editing and saving while a delayed attachment replaces the document', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="chat-loading" />);
  await open();
  const oldViewer = screen.getByTestId('viewer');
  const replacement = await mock.open();
  const pending =
    Promise.withResolvers<Awaited<ReturnType<typeof mock.open>>>();
  mock.chat.mockReturnValue(pending.promise);
  await act(async () => {
    await Promise.resolve();
    publishAttachment(document, 'chat-loading', {
      key: 'pending',
      files: [
        {
          attachmentId: 'new',
          name: 'test.pptx',
          bytes: 2,
        } as FileAttachmentRef,
      ],
    });
  });
  expect(
    screen.getByTestId('viewer').parentElement?.hasAttribute('inert'),
  ).toBe(true);
  const shortcut = vi.fn();
  window.addEventListener('keydown', shortcut);
  try {
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(shortcut).not.toHaveBeenCalled();
    // The canonical modal owns its own capture handler and native key defaults.
    const dialog = document.createElement('dialog');
    dialog.className = 'pptx-confirm';
    const cancel = document.createElement('button');
    dialog.append(cancel);
    document.body.append(dialog);
    expect(fireEvent.keyDown(cancel, { key: 'Escape' })).toBe(true);
    expect(shortcut).toHaveBeenCalledOnce();
    dialog.remove();
  } finally {
    window.removeEventListener('keydown', shortcut);
  }
  expect(() => read()).toThrow('in progress');
  await act(async () => {
    inspectClosingEditor(frame);
    pending.resolve(replacement);
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByTestId('viewer')).toBe(oldViewer);
  expect(() => read()).toThrow('closed');
  act(() => {
    resumeEditor(frame);
  });
  // A closed frame must not commit a download that finished after closing.
  expect(mock.editor.getSlides()).toHaveLength(1);
  view.unmount();
  frame.remove();
});
function edit() {
  const value = read();
  act(() => {
    command({
      kind: 'edit',
      edit: {
        documentId: value.documentId,
        version: value.version,
        slideIndex: 0,
        elementId: 'title',
        summary: 'Synthetic title edit',
        patch: { text: 'After' },
      },
    });
  });
}

it('blocks Agent commands while a native recovery decision is open or loading', async () => {
  render(<App sessionId="conversation" />);
  await open();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  screen.getByTestId('viewer').append(dialog);
  expect(() => read()).toThrow('Resolve the open editor dialog');
  expect(mock.editor.getContent).not.toHaveBeenCalled();
  dialog.remove();
  const viewer = screen.getByTestId('viewer');
  viewer.setAttribute('aria-busy', 'true');
  expect(() => read()).toThrow('presentation is loading');
  expect(() => {
    edit();
  }).toThrow('presentation is loading');
  expect(mock.editor.getContent).not.toHaveBeenCalled();
  expect(mock.editor.updateElement).not.toHaveBeenCalled();
  viewer.setAttribute('aria-busy', 'false');
  edit();
  expect(mock.editor.updateElement).toHaveBeenCalledOnce();
});

it('owns direct editing without duplicating viewer file controls', async () => {
  const { unmount } = render(<App sessionId="conversation" />);
  expect(() => command({ kind: 'read' })).toThrow('Open a PPTX');
  await open();
  edit();
  expect(screen.queryByText('确认应用')).toBeNull();
  expect(screen.queryByText('拒绝')).toBeNull();
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(mock.editor.updateElement).toHaveBeenCalledOnce();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.queryByText('保存到原文件')).toBeNull();
  expect(screen.queryByText('未写回本机')).toBeNull();
  await act(async () => {
    await Promise.resolve();
    await i18n.changeLanguage('en');
  });
  expect(screen.queryByText('Save original')).toBeNull();
  await act(async () => {
    await Promise.resolve();
    await i18n.changeLanguage('zh-CN');
  });
  expect(read().documentId).toBeDefined();
  unmount();
  expect(mock.signal?.aborted).toBe(true);
});

it('rejects stale Agent requests after manual interaction and refuses unfinished inline text', async () => {
  render(<App sessionId="conversation" />);
  await open();
  const before = read();
  fireEvent.pointerDown(screen.getByLabelText('Inline text'));
  act(() => {
    expect(() =>
      command({
        kind: 'edit',
        edit: {
          documentId: before.documentId,
          version: before.version,
          slideIndex: 0,
          elementId: 'title',
          summary: 'Stale edit',
          patch: { text: 'After' },
        },
      }),
    ).toThrow('Stale');
  });
  expect(mock.editor.updateElement).not.toHaveBeenCalled();
  const input = screen.getByLabelText('Inline text');
  expect(screen.queryByRole('alert')).toBeNull();
  input.focus();
  fireEvent.change(input, { target: { value: 'Typing' } });
  expect(() => command({ kind: 'read' })).toThrow('Finish');
  expect(fireEvent.keyDown(input, { key: 's', ctrlKey: true })).toBe(true);
  expect(mock.editor.getContent).not.toHaveBeenCalled();
  input.blur();
  fireEvent.keyDown(input, { key: 'a' });
  fireEvent.click(screen.getByText('Navigate slide'));
  fireEvent.keyDown(input, { key: 's', metaKey: true });
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(mock.editor.getContent).not.toHaveBeenCalled();
});

it('prompts before replacing a dirty document through the viewer open action', async () => {
  render(<App sessionId="conversation" />);
  await open();
  edit();
  fireEvent.click(screen.getByText('Viewer open'));
  await act(async () => {});
  expect(mock.open).toHaveBeenCalledOnce();
  mock.confirm.mockResolvedValue(true);
  fireEvent.click(screen.getByText('Viewer open'));
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(mock.open).toHaveBeenCalledTimes(2);
});

it('follows the host locale without replacing the document or its unsaved edits', async () => {
  const hostFrame = document.createElement('iframe');
  document.body.append(hostFrame);
  const host = hostFrame.contentDocument as Document;
  host.documentElement.lang = 'zh-CN';
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(
    host.createElement('iframe'),
  );
  const view = render(<App sessionId="conversation" />);
  expect(
    screen.queryByRole('combobox', { name: 'Language / 语言' }),
  ).toBeNull();
  await open();
  edit();
  const before = read();
  const viewer = screen.getByTestId('viewer');
  await act(async () => {
    await Promise.resolve();
    host.documentElement.lang = 'en';
    await Promise.resolve();
  });
  expect(document.documentElement.lang).toBe('en');
  fireEvent.click(screen.getByText('Viewer light theme'));
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(writeStoredViewerPrefs).toHaveBeenCalledWith({
    themeKey: 'vermilionLight',
  });
  await act(async () => {
    await Promise.resolve();
    host.documentElement.lang = 'zh-CN';
    await vi.advanceTimersByTimeAsync(0);
  });
  expect({ language: i18n.language, resolved: i18n.resolvedLanguage }).toEqual({
    language: 'zh-CN',
    resolved: 'zh-CN',
  });
  expect(screen.getByTestId('viewer')).toBe(viewer);
  expect(read()).toEqual(before);
  expect(mock.editor.getSlides()[0]?.elements[0]).toMatchObject({
    text: 'After',
  });
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(mock.open).toHaveBeenCalledOnce();
  view.unmount();
  hostFrame.remove();
});

it('handles picker cancellation, open failure, loading timeout and connection failure', async () => {
  mock.open.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  const view = render(<App sessionId="conversation" />);
  await open();
  expect(screen.queryByRole('alert')).toBeNull();
  mock.open.mockRejectedValueOnce(new Error('Invalid PPTX'));
  await open();
  expect(screen.getByRole('alert').textContent).toBe('Invalid PPTX');
  mock.count = 0;
  await open();
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_100);
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'PPTX could not be loaded',
  );
  view.unmount();
  mock.connect.mockRejectedValueOnce(new Error('Disconnected'));
  render(<App sessionId="other" />);
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('alert').textContent).toBe('Disconnected');
});

it('keeps genuine failures visible even when their text resembles a stale rejection', async () => {
  render(<App sessionId="failure-feedback" />);
  await open();
  const before = read();
  const message = 'Stale edit: read the document again';
  vi.mocked(mock.editor.updateElement).mockImplementationOnce(() => {
    throw new Error(message);
  });
  act(() => {
    expect(() => {
      edit();
    }).toThrow(message);
  });
  expect(screen.getByRole('alert').textContent).toBe(message);
  act(() => {
    expect(() =>
      command({
        kind: 'add-slide',
        change: {
          documentId: before.documentId,
          version: before.version,
          summary: 'Old request',
        },
      }),
    ).toThrow('Stale');
  });
  expect(mock.editor.addSlide).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe(message);
});

it('rejects a previous document identity without a toast, then duplicates exactly once after a fresh read', async () => {
  Object.assign(mock.editor, operationFixture().editor);
  render(<App sessionId="stale-copy" />);
  await open();
  const before = read();
  fireEvent.click(screen.getByText('Viewer open'));
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const current = read();
  expect(current.documentId).not.toBe(before.documentId);
  const request = (state: typeof before): EditorCommand => ({
    kind: 'operate',
    change: {
      documentId: state.documentId,
      version: state.version,
      operation: 'duplicate-slide',
      slideIndex: 0,
      summary: 'Copy the first slide',
    },
  });
  act(() => {
    expect(() => command(request(before))).toThrow('Stale');
  });
  expect(mock.editor.duplicateSlides).not.toHaveBeenCalled();
  expect(mock.editor.getSlides()).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => {
    command(request(current));
    expect(() => command(request(current))).toThrow('Stale');
  });
  expect(mock.editor.duplicateSlides).toHaveBeenCalledOnce();
  expect(mock.editor.getSlides()).toHaveLength(3);
  expect(screen.queryByRole('alert')).toBeNull();
  mock.editor.undo();
  expect(mock.editor.getSlides()).toHaveLength(2);
});

it('shows an application failure and blocks overlapping file opens', async () => {
  render(<App sessionId="conversation" />);
  await open();
  vi.mocked(mock.editor.updateElement).mockImplementationOnce(() => {
    throw new Error('Apply failed');
  });
  act(() => {
    expect(() => {
      edit();
    }).toThrow('Apply failed');
  });
  expect(screen.getByRole('alert').textContent).toBe('Apply failed');
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull();
  const picking =
    Promise.withResolvers<Awaited<ReturnType<typeof mock.open>>>();
  mock.open.mockReturnValueOnce(picking.promise);
  fireEvent.click(screen.getByText('Viewer open'));
  fireEvent.click(screen.getByText('Viewer open'));
  expect(mock.open).toHaveBeenCalledTimes(2);
  await act(async () => {
    await Promise.resolve();
    picking.reject(new DOMException('Cancelled', 'AbortError'));
    await picking.promise.catch(() => undefined);
  });
});

it.each([false, true])(
  'blocks delayed Agent edits during file selection (cancel=%s)',
  async (cancel) => {
    render(<App sessionId="conversation" />);
    await open();
    const before = read();
    const request: EditorCommand = {
      kind: 'edit',
      edit: {
        documentId: before.documentId,
        version: before.version,
        slideIndex: 0,
        elementId: 'title',
        summary: 'Delayed edit',
        patch: { text: 'After' },
      },
    };
    const selected = (await mock.open.mock.results[0]?.value) as
      OpenedDocument | undefined;
    if (!selected) throw new Error('Missing selected test document');
    const picker = Promise.withResolvers<OpenedDocument>();
    mock.open.mockReturnValueOnce(picker.promise);
    fireEvent.click(screen.getByText('Viewer open'));
    expect(() => command(request)).toThrow('File selection in progress');
    expect(() => read()).toThrow('File selection in progress');
    expect(mock.editor.updateElement).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      if (cancel) picker.reject(new DOMException('Cancelled', 'AbortError'));
      else picker.resolve(selected);
      await picker.promise.catch(() => undefined);
    });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mock.confirm).not.toHaveBeenCalled();
    expect(read().documentId === before.documentId).toBe(cancel);
    let failure = '';
    act(() => {
      try {
        command(request);
      } catch (reason) {
        failure = (reason as Error).message;
      }
    });
    expect(failure).toBe(cancel ? '' : 'Stale edit: read the document again');
    expect(mock.editor.updateElement).toHaveBeenCalledTimes(cancel ? 1 : 0);
  },
);

it('ignores a file picker result arriving after the panel closes', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="conversation" />);
  await open();
  const before = read();
  const selected = (await mock.open.mock.results[0]?.value) as
    OpenedDocument | undefined;
  if (!selected) throw new Error('Missing selected test document');
  const picker = Promise.withResolvers<OpenedDocument>();
  mock.open.mockReturnValueOnce(picker.promise);
  fireEvent.click(screen.getByText('Viewer open'));
  act(() => {
    expect(inspectClosingEditor(frame).dirty).toBe(true);
  });
  await act(async () => {
    picker.resolve(selected);
    await picker.promise;
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(() => read()).toThrow('closed');
  await act(async () => {
    resumeEditor(frame);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(read().documentId).toBe(before.documentId);
  view.unmount();
  frame.remove();
});

it('suspends Agent access on close and resumes the same document without replay', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="conversation" />);
  await open();
  const before = read();
  let dirty = true;
  act(() => {
    dirty = inspectClosingEditor(frame).dirty;
  });
  expect(dirty).toBe(false);
  expect(mock.signal?.aborted).toBe(true);
  expect(() => read()).toThrow('closed');
  act(() => {
    resumeEditor(frame);
  });
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(read().documentId).toBe(before.documentId);
  expect(mock.connect).toHaveBeenCalledTimes(2);
  act(() => {
    resumeEditor(frame);
  });
  expect(mock.connect).toHaveBeenCalledTimes(2);
  edit();
  act(() => {
    dirty = inspectClosingEditor(frame).dirty;
  });
  expect(dirty).toBe(true);
  expect(screen.getByText('恢复视图')).toBeDefined();
  view.unmount();
  frame.remove();
});

it('offers explicit reconnection after failure while retaining the editor occurrence', async () => {
  mock.connect.mockRejectedValueOnce(new Error('Offline'));
  render(<App sessionId="conversation" />);
  await open();
  expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  const viewer = screen.getByTestId('viewer');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByTestId('viewer')).toBe(viewer);
  expect(screen.queryByText('Agent 已连接')).toBeNull();
  expect(mock.connect).toHaveBeenCalledTimes(2);
  edit();
  expect(mock.editor.updateElement).toHaveBeenCalledOnce();
  expect(screen.queryByText('确认应用')).toBeNull();
});

it('routes slide and text insertion through the live editor and its common interaction fences', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frame);
  const view = render(<App sessionId="insertions" />);
  const base = () => {
    const { documentId, version } = read();
    return { documentId, version };
  };
  const slide = (): EditorCommand => ({
    kind: 'add-slide',
    change: { ...base(), summary: 'New slide' },
  });
  // No document is silently created when the user has not opened a file.
  expect(() =>
    command({
      kind: 'add-slide',
      change: {
        documentId: crypto.randomUUID(),
        version: 0,
        summary: 'New slide',
      },
    }),
  ).toThrow('Open a PPTX');
  await open();
  const input = slide();
  act(() => {
    command(input);
  });
  expect(mock.editor.getSlides()).toHaveLength(2);
  expect(mock.editor.getActiveSlideIndex()).toBe(1);
  act(() => {
    expect(() => command(input)).toThrow('Stale');
  });
  expect(screen.queryByRole('alert')).toBeNull();
  const text: EditorCommand = {
    kind: 'add-text',
    change: {
      ...base(),
      slideIndex: 1,
      summary: 'New text',
      text: 'Added from conversation',
      x: 40,
      y: 40,
      width: 400,
      height: 80,
    },
  };
  const inline = screen.getByLabelText('Inline text');
  inline.focus();
  expect(() => command(text)).toThrow('Finish');
  inline.blur();
  expect(() =>
    command({ ...text, attachmentKey: 'different-attachment' }),
  ).toThrow('not loaded');
  act(() => {
    command(text);
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mock.editor.getSlides()[1]?.elements).toEqual([
    expect.objectContaining({
      id: 'inserted-text',
      text: 'Added from conversation',
    }),
  ]);
  const afterInsertion = slide();
  act(() => {
    inspectClosingEditor(frame);
  });
  expect(() => command(afterInsertion)).toThrow('closed');
  view.unmount();
  frame.remove();
});

it('routes document operations through current viewer handles and shared editor fences', async () => {
  Object.assign(mock.editor, operationFixture().editor);
  render(<App sessionId="operations" />);
  await open();
  const imageBase = read();
  act(() => {
    command({
      kind: 'add-image',
      change: {
        documentId: imageBase.documentId,
        version: imageBase.version,
        summary: 'Insert image',
        slideIndex: 0,
        imageData: 'data:image/png;base64,AQID',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    });
  });
  const op = (input: Record<string, unknown>) => {
    const state = read();
    const change = operationSchema.parse({
      documentId: state.documentId,
      version: state.version,
      summary: 'Operation',
      ...input,
    });
    let result: unknown;
    act(() => {
      result = command({ kind: 'operate', change });
    });
    return result;
  };
  const inline = screen.getByLabelText('Inline text');
  inline.focus();
  expect(() => op({ operation: 'navigate', slideIndex: 1 })).toThrow('Finish');
  inline.blur();
  op({ operation: 'navigate', slideIndex: 1 });
  op({ operation: 'duplicate-slide', slideIndex: 1 });
  op({ operation: 'move-slide', slideIndex: 2, toIndex: 0 });
  op({ operation: 'set-slide-hidden', slideIndex: 0, hidden: true });
  op({ operation: 'delete-slide', slideIndex: 0 });
  op({ operation: 'undo' });
  op({ operation: 'redo' });
  op({ operation: 'navigate', slideIndex: 0 });
  op({
    operation: 'arrange-elements',
    slideIndex: 0,
    elementIds: ['a', 'b'],
    arrangement: 'left',
  });
  op({ operation: 'delete-elements', slideIndex: 0, elementIds: ['a'] });
  expect(mock.editor.getSlides()[0]?.elements.some((el) => el.id === 'c')).toBe(
    true,
  );
  op({ operation: 'duplicate-element', slideIndex: 0, elementId: 'b' });
  op({
    operation: 'add-shape',
    slideIndex: 0,
    shape: 'rect',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  });
  expect(screen.queryByRole('alert')).toBeNull();
});
