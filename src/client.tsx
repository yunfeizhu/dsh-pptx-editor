import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attachPanel } from './panel-lifetime.js';
import { errorMessage } from './protocol.js';
import { watchChatAttachments } from './chat-attachments.js';
import {
  publishAttachment,
  observeAttachment,
  navigateAttachmentOnce,
  requestPanelOpen,
  observePanelOpen,
  attachmentWatchState,
} from './attachment-intake.js';
import type { AttachmentIntent } from './attachments.js';

export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions'];
const ID = 'dsh-pptx-viewer';

export function PptxAttachmentLauncher({
  sessionId,
  openTab,
  isCurrent,
}: {
  sessionId: string;
  openTab: () => void;
  isCurrent: (id: string) => boolean;
}) {
  const [failed, setFailed] = useState<AttachmentIntent>();
  useEffect(() => {
    let active = true;
    const navigate = (intent: AttachmentIntent) => {
      // Run after the commit's passive effects publish the native right-sidebar binding.
      queueMicrotask(() => {
        if (!active || !isCurrent(sessionId)) return;
        try {
          navigateAttachmentOnce(document, sessionId, intent, openTab);
          setFailed(undefined);
        } catch {
          setFailed(intent);
        }
      });
    };
    const stop = observeAttachment(document, sessionId, navigate);
    const stopReopen = observePanelOpen(document, sessionId, (id) => {
      navigate({ key: `reopen:${id}`, files: [] });
    });
    return () => {
      active = false;
      stop();
      stopReopen();
    };
  }, [sessionId, openTab, isCurrent]);
  if (!failed) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (!isCurrent(sessionId)) return;
        try {
          navigateAttachmentOnce(document, sessionId, failed, openTab);
          setFailed(undefined);
        } catch {
          /* Keep the explicit retry available while the host panel is unavailable. */
        }
      }}
      style={{
        font: 'inherit',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-general, #e5e7eb)',
        borderRadius: 10,
        padding: '6px 12px',
        cursor: 'pointer',
      }}
    >
      {document.documentElement.lang.startsWith('zh')
        ? '在右侧打开 PPTX'
        : 'Open PPTX in side panel'}
    </button>
  );
}

export interface PanelProps {
  sessionId: string;
  useTabInfo: () => SidebarRightTabInfo;
}

export function PptxPanel({ sessionId, useTabInfo }: PanelProps) {
  const { tab } = useTabInfo();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    // React attaches this host before running layout effects.
    const element = host.current as HTMLDivElement;
    try {
      return attachPanel(element, sessionId, tab.signal);
    } catch (reason) {
      setError(errorMessage(reason));
      return undefined;
    }
  }, [sessionId, tab.signal]);
  return (
    <div ref={host} style={{ width: '100%', height: '100%', minHeight: 0 }}>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: ID,
        kind: 'pptx-editor',
        title: () => 'PPTX',
      }),
    'pptx: tab type',
  );
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: ID },
          PptxPanel,
        ),
      ),
    'pptx: tab body',
  );
  ctx.effect(
    () =>
      watchChatAttachments(
        ctx.sessions,
        (sessionId, intent, source) => {
          publishAttachment(document, sessionId, intent, source);
        },
        (sessionId, id) => {
          requestPanelOpen(document, sessionId, id);
        },
        attachmentWatchState(document),
      ),
    'pptx: admitted chat attachments',
  );
  const openTab = () => {
    ctx.sidebarRight.openTab('pptx-editor');
  };
  const isCurrent = (id: string) =>
    ctx.sessions.list.getSnapshot().current === id;
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: ID,
            inject: () => ({ openTab, isCurrent }),
          },
          PptxAttachmentLauncher,
        ),
      ),
    'pptx: conversation attachment navigation',
  );
}
