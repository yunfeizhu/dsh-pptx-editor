import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import {
  PptxAttachmentLauncher,
  PptxPanel,
  type PanelProps,
} from '../../src/client.js';
import {
  publishAttachment,
  requestPanelOpen,
} from '../../src/attachment-intake.js';

document.documentElement.lang = 'zh-CN';

function Harness() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') ?? 'synthetic-session';
  const restoreHistory = params.has('restore');
  const [controller, setController] = useState(() => new AbortController());
  const [visible, setVisible] = useState(!restoreHistory);
  const open = () => {
    setController(new AbortController());
    setVisible(true);
  };
  useEffect(() => {
    if (restoreHistory)
      publishAttachment(
        document,
        sessionId,
        { key: 'history', files: [] },
        'restore',
      );
  }, [restoreHistory, sessionId]);
  const useTabInfo = () =>
    ({ tab: { id: 'synthetic-tab', signal: controller.signal } }) as ReturnType<
      PanelProps['useTabInfo']
    >;
  return (
    <main>
      {restoreHistory && (
        <>
          <PptxAttachmentLauncher
            sessionId={sessionId}
            openTab={open}
            isCurrent={(id) => id === sessionId}
          />
          <button
            onClick={() => {
              requestPanelOpen(document, sessionId, crypto.randomUUID());
            }}
          >
            Reopen through conversation
          </button>
          <button
            onClick={() => {
              publishAttachment(document, sessionId, {
                key: crypto.randomUUID(),
                files: [],
              });
            }}
          >
            Send new attachment
          </button>
        </>
      )}
      <button
        onClick={() => {
          document.documentElement.lang = 'en';
        }}
      >
        DSH English
      </button>
      <button
        onClick={() => {
          document.documentElement.lang = 'zh-CN';
        }}
      >
        DSH 中文
      </button>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        Switch tab
      </button>
      <button
        onClick={() => {
          controller.abort();
          setVisible(false);
        }}
      >
        Close tab
      </button>
      <button
        onClick={() => {
          setController(new AbortController());
          setVisible(true);
        }}
      >
        Open tab
      </button>
      <section style={{ height: 'calc(100vh - 40px)' }}>
        {visible && (
          <PptxPanel
            sessionId={
              new URLSearchParams(location.search).get('session') ??
              'synthetic-session'
            }
            useTabInfo={useTabInfo}
          />
        )}
      </section>
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Test root missing');
createRoot(root).render(<Harness />);
