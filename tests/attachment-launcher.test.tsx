// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { apply, PptxAttachmentLauncher } from '../src/client.js';
import {
  publishAttachment,
  requestPanelOpen,
} from '../src/attachment-intake.js';
import { setPanelDismissed, isPanelDismissed } from '../src/panel-dismissal.js';

afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
});

it('does not reopen dismissed history on remount, but admits a fresh attachment or explicit request', async () => {
  const sessionId = 'dismissed-history';
  const openTab = vi.fn();
  const props = { sessionId, openTab, isCurrent: () => true };
  setPanelDismissed(document, sessionId, true);
  publishAttachment(document, sessionId, { key: 'old', files: [] }, 'restore');
  const view = render(<PptxAttachmentLauncher {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).not.toHaveBeenCalled();
  view.unmount();
  render(<PptxAttachmentLauncher {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).not.toHaveBeenCalled();
  await act(async () => {
    requestPanelOpen(document, sessionId, 'fresh-call');
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledOnce();
  setPanelDismissed(document, sessionId, true);
  await act(async () => {
    requestPanelOpen(document, sessionId, 'fresh-call');
    publishAttachment(document, sessionId, { key: 'old', files: [] });
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledOnce();
  expect(isPanelDismissed(document, sessionId)).toBe(true);
  await act(async () => {
    publishAttachment(document, sessionId, { key: 'new', files: [] });
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(2);
  expect(isPanelDismissed(document, sessionId)).toBe(false);
});

it('lets a close cancel already queued automatic navigation', async () => {
  const sessionId = 'close-before-navigation';
  const openTab = vi.fn();
  publishAttachment(document, sessionId, { key: 'queued', files: [] });
  render(
    <PptxAttachmentLauncher
      sessionId={sessionId}
      openTab={openTab}
      isCurrent={() => true}
    />,
  );
  setPanelDismissed(document, sessionId, true);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).not.toHaveBeenCalled();
});

it('opens only after the native seat has mounted, dedupes remounts and opens later attachments', async () => {
  const sessionId = 'launcher-live';
  const openTab = vi.fn();
  const isCurrent = () => true;
  publishAttachment(document, sessionId, { key: 'first', files: [] });
  const props = { sessionId, openTab, isCurrent };
  const view = render(<PptxAttachmentLauncher {...props} />);
  expect(openTab).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledOnce();
  view.unmount();
  render(<PptxAttachmentLauncher {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledOnce();
  await act(async () => {
    publishAttachment(document, sessionId, { key: 'second', files: [] });
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(2);
});

it('ignores stale sessions and cancels queued navigation on unmount', async () => {
  const openTab = vi.fn();
  publishAttachment(document, 'stale-session', { key: 'first', files: [] });
  const view = render(
    <PptxAttachmentLauncher
      sessionId="stale-session"
      openTab={openTab}
      isCurrent={() => false}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).not.toHaveBeenCalled();
  view.rerender(
    <PptxAttachmentLauncher
      sessionId="stale-session"
      openTab={openTab}
      isCurrent={() => true}
    />,
  );
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).not.toHaveBeenCalled();
});

it('reopens once per explicit request without replacing a retained document or replaying on remount', async () => {
  const sessionId = 'explicit-reopen';
  const openTab = vi.fn();
  const props = { sessionId, openTab, isCurrent: () => true };
  publishAttachment(document, sessionId, { key: 'attachment', files: [] });
  requestPanelOpen(document, sessionId, 'first-call');
  const view = render(<PptxAttachmentLauncher {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(2);
  view.unmount();
  render(<PptxAttachmentLauncher {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(2);
  await act(async () => {
    requestPanelOpen(document, 'another-session', 'other-call');
    requestPanelOpen(document, sessionId, 'first-call');
    requestPanelOpen(document, sessionId, 'second-call');
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(3);
});

it.each(['zh-CN', 'en'])(
  'keeps a localized retry until navigation succeeds (%s)',
  async (locale) => {
    document.documentElement.lang = locale;
    const sessionId = `retry-${locale}`;
    let current = true;
    const openTab = vi.fn<() => void>(() => {
      throw new Error('Seat unavailable');
    });
    publishAttachment(document, sessionId, { key: 'first', files: [] });
    const view = render(
      <PptxAttachmentLauncher
        sessionId={sessionId}
        openTab={openTab}
        isCurrent={() => current}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const name =
      locale === 'en' ? 'Open PPTX in side panel' : '在右侧打开 PPTX';
    const retry = view.getByRole('button', { name });
    current = false;
    fireEvent.click(retry);
    expect(openTab).toHaveBeenCalledOnce();
    current = true;
    fireEvent.click(retry);
    expect(openTab).toHaveBeenCalledTimes(2);
    expect(view.getByRole('button', { name })).toBe(retry);
    openTab.mockImplementation(() => {});
    fireEvent.click(retry);
    expect(view.queryByRole('button')).toBeNull();
  },
);

it('routes admitted session events through the public composer slot before native navigation', async () => {
  const sessionId = 'public-composer';
  let update = () => {};
  let entries: unknown[] = [];
  let launcherProps:
    { openTab: () => void; isCurrent: (id: string) => boolean } | undefined;
  const disposers: (() => void)[] = [];
  const openTab = vi.fn();
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ current: sessionId }),
        subscribe: () => () => {},
      },
      binding: () => ({
        eventSource: {
          getSnapshot: () => ({ entries, change: { kind: 'append', entries } }),
          subscribe: (fn: () => void) => {
            update = fn;
            return () => {};
          },
        },
      }),
    },
    sidebarRight: { openTab },
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_seat: string, start: () => unknown) => start(),
      register: (spec: {
        name: string;
        inject?: () => typeof launcherProps;
      }) => {
        if (spec.name === 'conversation.composer.dock')
          launcherProps = spec.inject?.();
        return () => {};
      },
    },
    effect: (start: () => () => void) => {
      disposers.push(start());
    },
  };
  apply(ctx as unknown as Context);
  if (!launcherProps) throw new Error('Composer registration missing');
  expect(launcherProps.isCurrent('other')).toBe(false);
  render(<PptxAttachmentLauncher sessionId={sessionId} {...launcherProps} />);
  entries = [
    {
      type: 'event',
      event: {
        type: 'user/message',
        seq: 1,
        data: {
          content: [
            {
              type: 'file',
              attachment: {
                attachmentId: 'synthetic',
                name: 'test.pptx',
                bytes: 1,
              },
            },
          ],
        },
      },
    },
  ];
  await act(async () => {
    update();
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledExactlyOnceWith('pptx-editor');
  entries = [
    {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 2,
        data: { name: 'open_pptx', callId: 'live-open', arguments: '{}' },
      },
    },
  ];
  await act(async () => {
    update();
    await Promise.resolve();
  });
  expect(openTab).toHaveBeenCalledTimes(2);
  for (const dispose of disposers.reverse()) dispose();
});
