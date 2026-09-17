// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { attachmentIntent, turnAttachment } from '../src/attachments.js';
import {
  observeAttachment,
  publishAttachment,
  attachmentWatchState,
} from '../src/attachment-intake.js';
import { watchChatAttachments } from '../src/chat-attachments.js';
import { readChatAttachment } from '../src/host/attachment.js';
import { MAX_FILE_BYTES } from '../src/protocol.js';

const ref = {
  attachmentId: 'synthetic',
  name: 'sample.PPTX',
  bytes: 3,
} as FileAttachmentRef;
function message(seq = 1, files = [ref]) {
  return {
    type: 'user/message',
    seq,
    data: {
      content: [
        {
          type: 'text',
          text: 'A filename in text is not attachment authority: fake.pptx',
        },
        ...files.map((attachment) => ({ type: 'file', attachment })),
      ],
    },
  } as SessionEvent;
}
const boundary = { type: 'turn/start', seq: 0 } as SessionEvent;

it('accepts only typed PPTX attachments and restricts tool matching to the current turn', () => {
  expect(attachmentIntent(boundary)).toBeUndefined();
  expect(
    attachmentIntent(message(1, [{ ...ref, name: 'doc.txt' }])),
  ).toBeUndefined();
  expect(attachmentIntent(message())?.files).toEqual([ref]);
  expect(turnAttachment([boundary, message(), message(2, [])])?.key).toBe(
    '1:synthetic',
  );
  expect(turnAttachment([message(), boundary, message(2, [])])).toBeUndefined();
  expect(turnAttachment([])).toBeUndefined();
});

it('routes once to the owning frame, including before the frame mounts, and disposes subscriptions', () => {
  const doc = document.implementation.createHTMLDocument();
  const receive = vi.fn();
  const intent = { key: 'one', files: [ref] };
  publishAttachment(doc, 'a', intent);
  const stop = observeAttachment(doc, 'a', receive);
  expect(receive).toHaveBeenCalledExactlyOnceWith(intent);
  publishAttachment(doc, 'b', intent);
  expect(receive).toHaveBeenCalledOnce();
  publishAttachment(doc, 'a', { ...intent, key: 'two' });
  expect(receive).toHaveBeenCalledTimes(2);
  stop();
  publishAttachment(doc, 'a', intent);
  expect(receive).toHaveBeenCalledTimes(2);
  observeAttachment(
    document.implementation.createHTMLDocument(),
    'absent',
    receive,
  )();
});

it('observes admitted files in new/existing conversations without replaying prepends or reopening closed tabs', () => {
  let current: string | undefined;
  let select = () => {};
  let update = () => {};
  let entries: { type: 'event' | 'transient'; event: SessionEvent }[] = [];
  let kind = 'replace';
  const release = vi.fn();
  const stopList = vi.fn();
  const sessions = {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (fn: () => void) => {
        select = fn;
        return stopList;
      },
    },
    binding: (id: string) =>
      id === 'missing'
        ? undefined
        : {
            eventSource: {
              getSnapshot: () => ({ entries, change: { kind, entries } }),
              subscribe: (fn: () => void) => {
                update = fn;
                return release;
              },
            },
          },
  };
  const open = vi.fn();
  const reopen = vi.fn();
  const doc = document.implementation.createHTMLDocument();
  const state = attachmentWatchState(doc);
  const stop = watchChatAttachments(
    sessions as unknown as ISessions,
    open,
    reopen,
    state,
  );
  current = 'a';
  select();
  select();
  entries = [
    { type: 'event', event: message() },
    { type: 'transient', event: boundary },
    { type: 'event', event: boundary },
  ];
  kind = 'append';
  update();
  update();
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0]?.[0]).toBe('a');
  expect(open.mock.calls[0]?.[2]).toBe('new');
  kind = 'prepend';
  entries = [{ type: 'event', event: message(9) }];
  update();
  expect(open).toHaveBeenCalledTimes(1);
  kind = 'append';
  update();
  expect(open).toHaveBeenCalledTimes(2);
  const call = {
    type: 'tool/call',
    seq: 10,
    data: { name: 'open_pptx', callId: 'call-one', arguments: '{}' },
  } as SessionEvent;
  entries = [{ type: 'event', event: call }];
  update();
  update();
  expect(reopen).toHaveBeenCalledExactlyOnceWith('a', 'call-one');
  kind = 'replace';
  entries = [{ type: 'event', event: message(3) }];
  update();
  expect(open).toHaveBeenCalledTimes(2);
  current = undefined;
  select();
  expect(release).toHaveBeenCalledOnce();
  current = 'missing';
  select();
  current = 'a';
  select();
  expect(open).toHaveBeenCalledTimes(2);
  stop();
  expect(stopList).toHaveBeenCalledOnce();
  const again = watchChatAttachments(
    sessions as unknown as ISessions,
    open,
    reopen,
    attachmentWatchState(doc),
  );
  expect(open).toHaveBeenCalledTimes(2);
  again();
});

it('reads bytes only from references admitted to this exact conversation and verifies bounded streams', async () => {
  const events = (files: FileAttachmentRef[]) => [boundary, message(1, files)];
  const store = {
    readFileStream: vi.fn(async function* () {
      yield await Promise.resolve(new Uint8Array([1]));
      yield await Promise.resolve(new Uint8Array([2, 3]));
    }),
  };
  expect(
    await readChatAttachment(events([ref]), ref.attachmentId, store),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(store.readFileStream).toHaveBeenCalledExactlyOnceWith(ref);
  await expect(
    readChatAttachment(undefined, ref.attachmentId, store),
  ).rejects.toThrow('not available');
  await expect(
    readChatAttachment(events([]), ref.attachmentId, store),
  ).rejects.toThrow('not available');
  await expect(
    readChatAttachment(events([ref]), '../private', store),
  ).rejects.toThrow('not available');
  await expect(
    readChatAttachment(
      events([{ ...ref, bytes: MAX_FILE_BYTES + 1 }]),
      ref.attachmentId,
      store,
    ),
  ).rejects.toThrow('50 MiB');
  await expect(
    readChatAttachment(events([{ ...ref, bytes: 2 }]), ref.attachmentId, store),
  ).rejects.toThrow('size');
  store.readFileStream.mockImplementation(async function* () {
    yield await Promise.resolve(new Uint8Array(MAX_FILE_BYTES + 1));
  });
  await expect(
    readChatAttachment(events([ref]), ref.attachmentId, store),
  ).rejects.toThrow('50 MiB');
  store.readFileStream.mockImplementation(async function* () {
    yield await Promise.resolve(new Uint8Array([1]));
    throw new Error('Integrity failed');
  });
  await expect(
    readChatAttachment(events([ref]), ref.attachmentId, store),
  ).rejects.toThrow('Integrity');
});

it('restores the latest history attachment on first binding, tolerates late bindings and never replays historical tool calls', () => {
  let select = () => {};
  let update = () => {};
  let available = false;
  let current = 'history';
  let entries: { type: 'event'; event: SessionEvent }[] = [];
  let kind = 'replace';
  const binding = {
    eventSource: {
      getSnapshot: () => ({ entries, change: { kind, entries } }),
      subscribe: (fn: () => void) => {
        update = fn;
        return () => {};
      },
    },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (fn: () => void) => {
        select = fn;
        return () => {};
      },
    },
    binding: () => (available ? binding : undefined),
  };
  const open = vi.fn();
  const reopen = vi.fn();
  const stop = watchChatAttachments(
    sessions as unknown as ISessions,
    open,
    reopen,
  );
  available = true;
  select();
  entries = [
    { type: 'event', event: message(1) },
    { type: 'event', event: message(4) },
  ];
  update();
  expect(open).toHaveBeenCalledExactlyOnceWith(
    'history',
    attachmentIntent(message(4)),
    'restore',
  );
  kind = 'prepend';
  entries = [{ type: 'event', event: message(0) }];
  update();
  expect(open).toHaveBeenCalledOnce();
  current = 'other';
  kind = 'append';
  entries = [
    {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 5,
        data: { name: 'open_pptx', callId: 'past', arguments: '{}' },
      } as SessionEvent,
    },
  ];
  select();
  expect(reopen).not.toHaveBeenCalled();
  stop();
});
