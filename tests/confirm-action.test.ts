// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confirmAction } from '../src/confirm-action.js';

beforeEach(() => {
  for (const name of ['showModal', 'close'])
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value() {},
    });
});
afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('describes the consequence, inherits the editor theme and restores trigger focus', async () => {
  const source = document.createElement('div');
  source.style.setProperty('--pptx-shell-background', '#171a1e');
  source.style.setProperty('--unrelated', 'red');
  source.style.colorScheme = 'dark';
  const trigger = document.createElement('button');
  document.body.append(source, trigger);
  trigger.focus();
  const result = confirmAction(
    'Open another presentation?',
    'Discard and open',
    'Cancel',
    {
      description: 'Unsaved changes will be discarded.',
      themeSource: source,
    },
  );
  const dialog = document.querySelector('dialog');
  expect(dialog?.querySelector('p')?.id).toBe(
    dialog?.getAttribute('aria-describedby'),
  );
  expect(dialog?.style.getPropertyValue('--pptx-shell-background')).toBe(
    '#171a1e',
  );
  expect(dialog?.style.getPropertyValue('--unrelated')).toBe('');
  expect(dialog?.style.colorScheme).toBe('dark');
  dialog?.querySelector('button')?.click();
  expect(await result).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it('isolates modal keys from an existing viewer capture listener and releases it on close', async () => {
  const viewerKey = vi.fn();
  document.addEventListener('keydown', viewerKey, true);
  try {
    const result = confirmAction('Discard?', 'Discard', 'Cancel');
    const dialog = document.querySelector('dialog');
    dialog
      ?.querySelector('button')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    expect(viewerKey).not.toHaveBeenCalled();
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(await result).toBe(false);
    expect(viewerKey).not.toHaveBeenCalled();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(viewerKey).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener('keydown', viewerKey, true);
  }
});

it.each(['cancel', 'accept', 'escape', 'keyboard'])(
  'requires an explicit affirmative action and cleans up on %s',
  async (action) => {
    const result = confirmAction('Discard draft?', 'Discard', 'Cancel');
    const dialog = document.querySelector('dialog');
    if (!dialog) throw new Error('Missing confirmation');
    expect(dialog.querySelector('h2')?.id).toBe(
      dialog.getAttribute('aria-labelledby'),
    );
    expect(document.activeElement?.textContent).toBe('Cancel');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }),
    );
    expect(dialog.isConnected).toBe(true);
    if (action === 'escape')
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    else if (action === 'keyboard') {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } else
      dialog.querySelectorAll('button')[action === 'accept' ? 1 : 0]?.click();
    expect(await result).toBe(action === 'accept');
    expect(document.querySelector('dialog')).toBeNull();
  },
);
