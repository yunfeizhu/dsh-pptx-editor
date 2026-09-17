// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { isEditorVisible } from '../src/editor-lifecycle.js';

afterEach(() => {
  vi.restoreAllMocks();
});
it.each([
  ['visible', true, {}, true],
  ['CSS-hidden', false, {}, false],
  ['zero width', true, { width: 0 }, false],
  ['zero height', true, { height: 0 }, false],
  ['above viewport', true, { bottom: 0 }, false],
  ['left of viewport', true, { right: 0 }, false],
  ['below viewport', true, { top: 1000 }, false],
  ['translated right', true, { left: 1000 }, false],
] as const)(
  'reports actual preview visibility: %s',
  (_name, cssVisible, patch, expected) => {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'checkVisibility', {
      value: () => cssVisible,
    });
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 200,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      ...patch,
    } as DOMRect);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
      1000,
    );
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(
      1000,
    );
    expect(isEditorVisible(frame)).toBe(expected);
    expect(isEditorVisible(null)).toBe(true);
  },
);
