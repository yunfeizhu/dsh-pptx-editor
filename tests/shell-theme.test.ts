// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { syncShellTheme } from '../src/editor/shell-theme.js';

afterEach(() => {
  document.body.innerHTML = '';
});

it('retains CSS fallbacks without a host frame', () => {
  const stop = syncShellTheme(null);
  stop();
  expect(
    document.documentElement.style.getPropertyValue('--pptx-shell-background'),
  ).toBe('');
});

it('copies only host color tokens, follows changes and removes its observer on disposal', async () => {
  const source = document.createElement('div');
  source.style.setProperty('--dsw-alias-bg-base', '#fff');
  source.style.setProperty('--dsw-alias-interactive-bg-hover', '#2631480f');
  source.style.setProperty('--private-token', 'unrelated');
  document.body.append(source);
  const stop = syncShellTheme(source);
  const root = document.documentElement;
  expect(root.style.getPropertyValue('--pptx-shell-background')).toBe('#fff');
  expect(root.style.getPropertyValue('--pptx-shell-hover')).toBe('#2631480f');
  expect(root.style.getPropertyValue('--private-token')).toBe('');
  source.style.setProperty('--dsw-alias-bg-base', '#171717');
  source.style.removeProperty('--dsw-alias-interactive-bg-hover');
  await Promise.resolve();
  expect(root.style.getPropertyValue('--pptx-shell-background')).toBe(
    '#171717',
  );
  expect(root.style.getPropertyValue('--pptx-shell-hover')).toBe('');
  stop();
  source.style.setProperty('--dsw-alias-bg-base', '#000');
  await Promise.resolve();
  expect(root.style.getPropertyValue('--pptx-shell-background')).toBe('');
});
