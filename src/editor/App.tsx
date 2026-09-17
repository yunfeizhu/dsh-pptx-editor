import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import editorI18n from 'i18next';
import { LoaderCircle, RotateCw, X } from 'lucide-react';
import {
  PowerPointViewer,
  defaultCssVars,
  readStoredViewerPrefs,
  resolveThemeCatalogEntry,
  themeToCssVars,
  writeStoredViewerPrefs,
  type PowerPointViewerHandle,
} from 'pptx-react-viewer';
import {
  DocumentSession,
  StaleDocumentError,
  type DocumentFile,
} from '../document-session.js';
import { errorMessage } from '../protocol.js';
import { openDocument } from './file.js';
import {
  CLOSE_EDITOR,
  RESUME_EDITOR,
  isEditorClosed,
  isEditorVisible,
  previousEditorRelease,
  type CloseRequest,
} from '../editor-lifecycle.js';
import { connectEditor } from './transport.js';
import { confirmAction } from '../confirm-action.js';
import { syncShellTheme } from './shell-theme.js';
import { syncHostLocale } from './host-locale.js';
import { observeAttachment } from '../attachment-intake.js';
import type { AttachmentIntent } from '../attachments.js';
import { loadChatFile } from './chat-file.js';
import { recoveryKey } from './recovery-key.js';

const copy = {
  zh: {
    open: '打开 PPTX',
    retryAttachment: '重试打开附件',
    oneAttachment: '请一次发送一份 PPTX，以确定要编辑的文稿。',
    attachmentBusy: '请先完成当前操作，再重试打开附件。',
    attachmentCancelled: '已保留当前文稿。可重试打开附件。',
    empty: '打开演示文稿，开始编辑',
    hint: '在左侧对话提出修改，内容会直接更新，可随时撤销。',
    scope:
      '支持新增和编辑；自动保存用于浏览器恢复，点击组件保存按钮下载 PPTX。',
    fileHint: '请选择本机 PPTX 文件（最多 50 MiB）。',
    closeError: '关闭错误提示',
    leaveTitle: '打开其他文稿？',
    recovery: '恢复视图',
    loading: '正在加载…',
    reconnect: '重试',
    connecting: '正在重连…',
    leave: '有未保存的修改，仍然打开其他文件吗？',
    cancel: '取消',
    openAnyway: '放弃修改并打开',
    disconnected: '对话连接已断开',
  },
  en: {
    open: 'Open PPTX',
    retryAttachment: 'Retry opening attachment',
    oneAttachment:
      'Send one PPTX at a time to choose the presentation to edit.',
    attachmentBusy:
      'Finish the current operation, then retry opening the attachment.',
    attachmentCancelled:
      'Current presentation kept. You can retry opening the attachment.',
    empty: 'Open a presentation to start editing',
    hint: 'Ask for edits in the conversation. Changes appear here immediately and support undo.',
    scope:
      'Add and edit slides. AutoSave keeps browser recovery copies; use the viewer Save button to download a PPTX.',
    fileHint: 'Choose a local PPTX file (up to 50 MiB).',
    closeError: 'Dismiss error',
    leaveTitle: 'Open another presentation?',
    recovery: 'Recovery',
    loading: 'Loading…',
    reconnect: 'Retry',
    connecting: 'Reconnecting…',
    leave: 'There are unsaved changes. Open another file anyway?',
    cancel: 'Cancel',
    openAnyway: 'Discard and open',
    disconnected: 'Chat connection lost',
  },
};

export function App({ sessionId }: { sessionId: string }) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'en' ? 'en' : 'zh';
  const localeCode = language === 'en' ? 'en' : 'zh-CN';
  const [themeKey, setThemeKey] = useState(
    () => readStoredViewerPrefs().themeKey ?? 'light',
  );
  useEffect(() => syncHostLocale(window.frameElement, editorI18n), []);
  useEffect(() => syncShellTheme(window.frameElement), []);
  useEffect(() => {
    document.documentElement.lang = localeCode;
    document.title = language === 'en' ? 'PPTX editor' : 'PPTX 编辑器';
  }, [localeCode, language]);
  useEffect(() => {
    document.documentElement.style.colorScheme =
      themeKey === 'light' || themeKey === 'vermilionLight' ? 'light' : 'dark';
    const vars = {
      ...defaultCssVars(),
      ...themeToCssVars(resolveThemeCatalogEntry(themeKey)),
    };
    for (const [name, value] of Object.entries(vars))
      document.documentElement.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars))
        document.documentElement.style.removeProperty(name);
    };
  }, [themeKey]);
  const t = copy[language];
  const [opened, setOpened] = useState<{
    file: DocumentFile;
    bytes: Uint8Array;
    occurrence: string;
    recoveryKey: string;
    attachmentKey?: string;
  }>();
  const attachmentKey = useRef<string | undefined>(undefined);
  const [incoming, setIncoming] = useState<AttachmentIntent>();
  const [attachmentEpoch, setAttachmentEpoch] = useState(0);
  const [attachmentFailed, setAttachmentFailed] = useState(false);
  const [loadingAttachment, setLoadingAttachment] = useState(false);
  const intakeController = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState('');
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restoreRetryFocus = useRef(false);
  const connectionDone = useRef<Promise<void> | undefined>(undefined);
  const [recovery, setRecovery] = useState(() =>
    isEditorClosed(window.frameElement),
  );
  const allowCommands = useRef(!recovery);
  const connection = useRef<AbortController | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const opening = useRef(false);
  const [, setTick] = useState(0);
  const editor = useRef<PowerPointViewerHandle>(null);
  const session = useRef<DocumentSession | undefined>(undefined);
  const editorRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loadingAttachment) return;
    // The viewer listens on window, outside the inert editor subtree.
    const blockShortcuts = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('dialog.pptx-confirm')
      )
        return;
      event.stopImmediatePropagation();
      if (event.key !== 'Tab') event.preventDefault();
    };
    window.addEventListener('keydown', blockShortcuts, true);
    return () => {
      window.removeEventListener('keydown', blockShortcuts, true);
    };
  }, [loadingAttachment]);
  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);
  const hasInlineEdit = () => {
    const active = document.activeElement;
    return (
      editorRoot.current?.contains(active) &&
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        active.matches('input,textarea,[role="textbox"]'))
    );
  };
  const hasViewerDialog = () =>
    Boolean(
      editorRoot.current?.querySelector('[role="dialog"][aria-modal="true"]'),
    );
  const isViewerLoading = () =>
    Boolean(editorRoot.current?.querySelector('[aria-busy="true"]'));

  useEffect(() => {
    if (reconnecting || !restoreRetryFocus.current) return;
    restoreRetryFocus.current = false;
    if (
      allowCommands.current &&
      document.hasFocus() &&
      document.activeElement === document.body
    )
      (connectionFailed
        ? retryButton.current
        : (openButton.current ?? editorRoot.current)
      )?.focus();
  }, [reconnecting, connectionFailed]);

  useEffect(() => {
    if (isEditorClosed(window.frameElement)) {
      allowCommands.current = false;
      setRecovery(true);
    }
    if (!allowCommands.current) return;
    const controller = new AbortController();
    connection.current = controller;
    const launch = () =>
      connectEditor(
        sessionId,
        (command) => {
          if (!allowCommands.current) throw new Error('PPTX panel is closed');
          if (
            command.kind === 'read' &&
            command.requireVisible &&
            !isEditorVisible(window.frameElement)
          )
            throw new Error('PPTX panel is not visible yet');
          if (opening.current)
            throw new Error(
              'File selection in progress; retry after it finishes',
            );
          if (isViewerLoading())
            throw new Error(
              'The presentation is loading; retry when it is ready',
            );
          if (hasInlineEdit())
            throw new Error(
              'Finish the current text edit before asking the Agent',
            );
          if (hasViewerDialog())
            throw new Error(
              'Resolve the open editor dialog before asking the Agent',
            );
          const current = session.current;
          if (
            command.attachmentKey &&
            command.attachmentKey !== attachmentKey.current
          )
            throw new Error(
              'The chat attachment is not loaded yet. Wait for the PPTX editor, then read again.',
            );
          if (!current)
            throw new Error('Open a PPTX file and wait for it to load');
          try {
            let result;
            switch (command.kind) {
              case 'edit-batch':
                return current.applyBatchEdit(command.change).then(
                  (result) => {
                    setError('');
                    refresh();
                    return result;
                  },
                  (reason: unknown) => {
                    if (!(reason instanceof StaleDocumentError))
                      setError(errorMessage(reason));
                    refresh();
                    throw reason;
                  },
                );
              case 'read':
                result = current.read();
                break;
              case 'edit':
                result = current.applyEdit(command.edit);
                break;
              case 'add-slide':
                result = current.addSlide(command.change);
                break;
              case 'operate':
                result = current.operate(command.change);
                break;
              case 'add-text':
                result = current.addText(command.change);
                break;
              case 'add-image':
                result = current.addImage(command.change);
                break;
            }
            if (command.kind !== 'read') setError('');
            refresh();
            return result;
          } catch (reason) {
            if (
              command.kind !== 'read' &&
              !(reason instanceof StaleDocumentError)
            )
              setError(errorMessage(reason));
            refresh();
            throw reason;
          }
        },
        controller.signal,
        () => {
          setReconnecting(false);
          setConnectionFailed(false);
          setConnected(true);
        },
      );
    const previous =
      connectionDone.current ?? previousEditorRelease(window.frameElement);
    const running = previous
      ? previous.then(() => {
          if (!controller.signal.aborted) return launch();
          return undefined;
        })
      : launch();
    connectionDone.current = running.catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setReconnecting(false);
        setConnected(false);
        setConnectionFailed(true);
        setError(errorMessage(reason));
      }
    });
    return () => {
      controller.abort();
    };
  }, [sessionId, refresh, connectionEpoch]);

  useEffect(() => {
    const parent = window.frameElement?.ownerDocument;
    if (!parent) return;
    return observeAttachment(parent, sessionId, setIncoming);
  }, [sessionId]);

  // The occurrence and retry intent own intake; render changes must not restart downloads/dialogs.
  const intakeState = useRef({ recovery, t });
  intakeState.current = { recovery, t };
  useEffect(() => {
    if (!incoming || incoming.key === attachmentKey.current || recovery) return;
    const controller = new AbortController();
    intakeController.current = controller;
    const start = async () => {
      const state = intakeState.current;
      if (opening.current || hasInlineEdit())
        throw new Error(state.t.attachmentBusy);
      const file = incoming.files[0];
      if (incoming.files.length !== 1 || !file)
        throw new Error(state.t.oneAttachment);
      opening.current = true;
      setLoadingAttachment(true);
      try {
        setAttachmentFailed(false);
        setError('');
        if (
          session.current?.dirty &&
          !(await confirmAction(
            state.t.leaveTitle,
            state.t.openAnyway,
            state.t.cancel,
            { description: state.t.leave },
          ))
        )
          throw new Error(state.t.attachmentCancelled);
        controller.signal.throwIfAborted();
        const result = await loadChatFile(sessionId, file, controller.signal);
        const key = await recoveryKey(
          sessionId,
          `attachment:${incoming.key}`,
          result.file.name,
          result.bytes,
        );
        controller.signal.throwIfAborted();
        if (!allowCommands.current || isEditorClosed(window.frameElement))
          throw new DOMException('Panel closed', 'AbortError');
        session.current?.dispose();
        session.current = undefined;
        attachmentKey.current = incoming.key;
        setOpened({
          ...result,
          occurrence: crypto.randomUUID(),
          attachmentKey: incoming.key,
          recoveryKey: key,
        });
      } finally {
        opening.current = false;
        setLoadingAttachment(false);
      }
    };
    void start().catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(errorMessage(reason));
      setAttachmentFailed(true);
    });
    return () => {
      controller.abort();
    };
  }, [incoming, attachmentEpoch, recovery, sessionId]);

  useEffect(() => {
    if (!opened) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const handle = editor.current;
      if (!handle || handle.getSlideCount() === 0) {
        if (Date.now() - started > 30_000) {
          clearInterval(timer);
          setError('PPTX could not be loaded');
        }
        return;
      }
      clearInterval(timer);
      const live = () => {
        if (!editor.current) throw new Error('Editor unavailable');
        return editor.current;
      };
      const port = {
        getSlides: () => editor.current?.getSlides() ?? [],
        getActiveSlideIndex: () => editor.current?.getActiveSlideIndex() ?? -1,
        getMode: () => editor.current?.getMode() ?? ('preview' as const),
        setActiveSlideIndex: (index: number) => {
          live().setActiveSlideIndex(index);
        },
        deleteSlides: (indexes: number[]) => {
          live().deleteSlides(indexes);
        },
        duplicateSlides: (indexes: number[]) => {
          live().duplicateSlides(indexes);
        },
        moveSlide: (from: number, to: number) => {
          live().moveSlide(from, to);
        },
        toggleHideSlides: (indexes: number[]) => {
          live().toggleHideSlides(indexes);
        },
        selectElements: (ids: string[]) => {
          live().selectElements(ids);
        },
        deleteElements: (ids: string[]) => {
          live().deleteElements(ids);
        },
        undo: () => {
          live().undo();
        },
        redo: () => {
          live().redo();
        },
        getSelectedElementIds: () => live().getSelectedElementIds(),
        canUndo: () => live().canUndo(),
        canRedo: () => live().canRedo(),
        addSlide: (afterIndex?: number) => {
          if (!editor.current) throw new Error('Editor unavailable');
          editor.current.addSlide(afterIndex);
        },
        addElement: (
          element: Parameters<PowerPointViewerHandle['addElement']>[0],
        ) => {
          if (!editor.current) throw new Error('Editor unavailable');
          return editor.current.addElement(element);
        },
        updateElement: (
          id: string,
          patch: Parameters<PowerPointViewerHandle['updateElement']>[1],
        ) => {
          if (!editor.current) throw new Error('Editor unavailable');
          editor.current.updateElement(id, patch);
        },
        updateElements: (
          updates: Parameters<PowerPointViewerHandle['updateElements']>[0],
          options?: Parameters<PowerPointViewerHandle['updateElements']>[1],
        ) => live().updateElements(updates, options),
        getContent: async () => {
          if (!editor.current) throw new Error('Editor unavailable');
          return editor.current.getContent();
        },
      };
      session.current = new DocumentSession(
        opened.file,
        opened.bytes,
        port,
        flushSync,
      );
      refresh();
    }, 100);
    return () => {
      clearInterval(timer);
      session.current?.dispose();
      session.current = undefined;
    };
    // The file occurrence, rather than the UI language, owns the editor lifetime.
  }, [opened, refresh]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.current?.dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  useEffect(() => {
    const frame = window.frameElement;
    if (!frame) return;
    const close = (event: Event) => {
      allowCommands.current = false;
      intakeController.current?.abort();
      connection.current?.abort();
      setConnected(false);
      setRecovery(true);
      (event as CustomEvent<CloseRequest>).detail.respond({
        dirty:
          opening.current || hasInlineEdit() || Boolean(session.current?.dirty),
        fileName: opened?.file.name ?? '',
        ...(connectionDone.current ? { released: connectionDone.current } : {}),
      });
    };
    const resume = () => {
      if (allowCommands.current) return;
      allowCommands.current = true;
      setRecovery(false);
      setConnectionEpoch((value) => value + 1);
    };
    frame.addEventListener(CLOSE_EDITOR, close);
    frame.addEventListener(RESUME_EDITOR, resume);
    return () => {
      frame.removeEventListener(CLOSE_EDITOR, close);
      frame.removeEventListener(RESUME_EDITOR, resume);
    };
  }, [opened]);

  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      if (
        session.current?.dirty &&
        !(await confirmAction(t.leaveTitle, t.openAnyway, t.cancel, {
          description: t.leave,
        }))
      )
        return;
      const result = await openDocument();
      const key = await recoveryKey(
        sessionId,
        'local',
        result.file.name,
        result.bytes,
      );
      if (!allowCommands.current || isEditorClosed(window.frameElement))
        throw new DOMException('Panel closed', 'AbortError');
      attachmentKey.current = undefined;
      setIncoming(undefined);
      setAttachmentFailed(false);
      session.current?.dispose();
      session.current = undefined;
      setError('');
      setOpened({
        ...result,
        occurrence: crypto.randomUUID(),
        recoveryKey: key,
      });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError'))
        setError(errorMessage(reason));
    } finally {
      opening.current = false;
    }
  };
  const invalidate = useCallback(() => {
    session.current?.invalidate(true);
    refresh();
  }, [refresh]);
  return (
    <main className="pptx-app">
      <div
        className="pptx-connection"
        hidden={!recovery && !connectionFailed}
        data-state={
          reconnecting
            ? 'connecting'
            : connectionFailed
              ? 'offline'
              : connected
                ? 'connected'
                : 'connecting'
        }
      >
        <span role="status">
          {recovery
            ? t.recovery
            : reconnecting
              ? t.connecting
              : connectionFailed
                ? t.disconnected
                : ''}
        </span>
        {connectionFailed && !recovery && (
          <button
            className="pptx-control pptx-reconnect"
            ref={retryButton}
            disabled={reconnecting}
            aria-busy={reconnecting}
            aria-label={t.reconnect}
            title={t.reconnect}
            onClick={() => {
              restoreRetryFocus.current =
                document.activeElement === retryButton.current;
              connection.current?.abort();
              session.current?.invalidate();
              setReconnecting(true);
              setError('');
              setConnectionEpoch((value) => value + 1);
            }}
          >
            {reconnecting ? (
              <LoaderCircle
                className="pptx-spin"
                aria-hidden="true"
                size={14}
              />
            ) : (
              <RotateCw aria-hidden="true" size={14} />
            )}
            <span>{t.reconnect}</span>
          </button>
        )}
      </div>
      {error && (
        <div className="pptx-error" role="alert">
          <span>{error}</span>
          {attachmentFailed && (
            <button
              className="pptx-control"
              onClick={() => {
                setAttachmentEpoch((value) => value + 1);
              }}
            >
              {t.retryAttachment}
            </button>
          )}
          <button
            className="pptx-control"
            aria-label={t.closeError}
            title={t.closeError}
            onClick={() => {
              setError('');
            }}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}
      {!opened ? (
        <section className="pptx-empty">
          <div className="pptx-mark">P</div>
          <h1>{t.empty}</h1>
          <p>{t.hint}</p>
          <p>{t.fileHint}</p>
          <button
            ref={openButton}
            onClick={() => {
              void open();
            }}
          >
            {t.open}
          </button>
          <small>{t.scope}</small>
        </section>
      ) : (
        <div
          className="pptx-editor"
          ref={editorRoot}
          inert={loadingAttachment}
          tabIndex={-1}
          onPointerDownCapture={invalidate}
          onKeyDownCapture={invalidate}
        >
          <PowerPointViewer
            key={opened.occurrence}
            ref={editor}
            content={opened.bytes}
            fileName={opened.file.name}
            filePath={opened.recoveryKey}
            canEdit
            autosave={Boolean(session.current)}
            autosaveIntervalMs={2000}
            defaultThemeKey={themeKey}
            onThemeChange={(key) => {
              setThemeKey(key);
              writeStoredViewerPrefs({ themeKey: key });
            }}
            defaultLocale={localeCode}
            availableLocales={[
              {
                code: 'zh-CN',
                label: 'Chinese (Simplified)',
                nativeLabel: '简体中文',
              },
              { code: 'en', label: 'English', nativeLabel: 'English' },
            ]}
            onOpenFile={() => {
              void open();
            }}
            onDirtyChange={refresh}
            onActiveSlideChange={invalidate}
          />
          {loadingAttachment && (
            <div className="pptx-busy" aria-label={t.loading}>
              {t.loading}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
