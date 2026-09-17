// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { isPanelDismissed, setPanelDismissed } from '../src/panel-dismissal.js';

function freshPage() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Test document missing');
  return doc;
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.replaceChildren();
});

it('retains only the closed preference across fresh documents, isolated by conversation', () => {
  const before = freshPage();
  expect(isPanelDismissed(before, 'a')).toBe(false);
  setPanelDismissed(before, 'a', true);
  const after = freshPage();
  expect(isPanelDismissed(after, 'a')).toBe(true);
  expect(isPanelDismissed(after, 'b')).toBe(false);
  setPanelDismissed(after, 'a', false);
  expect(isPanelDismissed(freshPage(), 'a')).toBe(false);
});

it('does not record unload as closing and accepts closes again after pageshow', () => {
  const doc = freshPage();
  setPanelDismissed(doc, 'unload', false);
  doc.defaultView?.dispatchEvent(new Event('pagehide'));
  setPanelDismissed(doc, 'unload', true);
  expect(isPanelDismissed(doc, 'unload')).toBe(false);
  expect(isPanelDismissed(freshPage(), 'unload')).toBe(false);
  doc.defaultView?.dispatchEvent(new Event('pageshow'));
  setPanelDismissed(doc, 'unload', true);
  expect(isPanelDismissed(freshPage(), 'unload')).toBe(true);
});

it('suppresses automatic restoration when storage is blocked but allows explicit opens', () => {
  const doc = freshPage();
  const storage = doc.defaultView?.sessionStorage;
  if (!storage) throw new Error('Test storage missing');
  vi.spyOn(
    Object.getPrototypeOf(storage) as Storage,
    'getItem',
  ).mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.spyOn(
    Object.getPrototypeOf(storage) as Storage,
    'setItem',
  ).mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.spyOn(
    Object.getPrototypeOf(storage) as Storage,
    'removeItem',
  ).mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  expect(isPanelDismissed(doc, 'blocked')).toBe(true);
  setPanelDismissed(doc, 'blocked', false);
  expect(isPanelDismissed(doc, 'blocked')).toBe(false);
  setPanelDismissed(doc, 'blocked', true);
  expect(isPanelDismissed(doc, 'blocked')).toBe(true);
});

it('supports detached documents without browser storage', () => {
  const doc = document.implementation.createHTMLDocument();
  expect(isPanelDismissed(doc, 'detached')).toBe(false);
  setPanelDismissed(doc, 'detached', true);
  expect(isPanelDismissed(doc, 'detached')).toBe(true);
  setPanelDismissed(doc, 'detached', false);
  expect(isPanelDismissed(doc, 'detached')).toBe(false);
});

it.each(['getItem', 'setItem', 'removeItem'] as const)(
  'keeps history closed across fresh documents when only %s fails',
  (method) => {
    const doc = freshPage();
    const after = freshPage();
    // Each iframe has its own Storage prototype; the browser restriction spans both pages.
    for (const page of [doc, after]) {
      const storage = page.defaultView?.sessionStorage;
      if (!storage) throw new Error('Test storage missing');
      vi.spyOn(
        Object.getPrototypeOf(storage) as Storage,
        method,
      ).mockImplementation(() => {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      });
    }
    setPanelDismissed(doc, 'write-failure', true);
    expect(isPanelDismissed(doc, 'write-failure')).toBe(true);
    expect(isPanelDismissed(after, 'write-failure')).toBe(true);
    setPanelDismissed(doc, 'write-failure', false);
    expect(isPanelDismissed(doc, 'write-failure')).toBe(false);
  },
);
