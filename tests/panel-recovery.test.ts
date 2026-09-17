// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createPanelRecovery } from '../src/panel-recovery.js';
import { confirmAction } from '../src/confirm-action.js';

vi.mock('../src/confirm-action.js', () => ({ confirmAction: vi.fn() }));

it('follows host locale and scoped theme, hides without discarding, and guards pending confirmation', async () => {
  document.documentElement.lang = 'zh-CN';
  document.body.style.setProperty('--dsw-alias-bg-base', '#fff');
  const view = createPanelRecovery();
  view.setFileName('A'.repeat(180) + '.pptx');
  view.notice.hidden = false;
  expect(view.notice.textContent).toContain('文稿已保留');
  expect(view.notice.textContent).not.toContain(' / ');
  expect(view.restore.textContent).toBe('继续编辑');
  const dismiss = view.notice.querySelector<HTMLButtonElement>(
    '[aria-label="隐藏提示"]',
  );
  if (!dismiss) throw new Error('Dismiss action missing');
  dismiss.click();
  expect(view.notice.hidden).toBe(true);
  expect(view.notice.isConnected).toBe(true);
  expect(confirmAction).not.toHaveBeenCalled();

  document.documentElement.lang = 'en';
  document.body.style.setProperty('--dsw-alias-bg-base', '#171717');
  await Promise.resolve();
  expect(view.restore.textContent).toBe('Continue editing');
  expect(view.close.textContent).toBe('Back to conversation');
  expect(view.overlay.getAttribute('aria-label')).toBe('Recover presentation');
  const root = view.notice.parentElement;
  if (!root) throw new Error('Recovery root missing');
  expect(root.style.getPropertyValue('--pptx-shell-background')).toBe(
    '#171717',
  );
  expect(
    document.documentElement.style.getPropertyValue('--pptx-shell-background'),
  ).toBe('');

  const decision = Promise.withResolvers<boolean>();
  vi.mocked(confirmAction).mockReturnValue(decision.promise);
  const first = view.confirmDiscard();
  expect(view.discard.disabled).toBe(true);
  expect(await view.confirmDiscard()).toBe(false);
  expect(confirmAction).toHaveBeenCalledExactlyOnceWith(
    'Discard unsaved changes?',
    'Discard changes',
    'Cancel',
    {
      description: `${'A'.repeat(180)}.pptx — This closes the retained editor. Export any changes you want to keep first.`,
      themeSource: root,
    },
  );
  decision.resolve(false);
  expect(await first).toBe(false);
  expect(view.discard.disabled).toBe(false);
  view.dispose();
  document.documentElement.lang = 'zh-CN';
  document.body.style.removeProperty('--dsw-alias-bg-base');
  await Promise.resolve();
  expect(root.isConnected).toBe(false);
  expect(view.restore.textContent).toBe('Continue editing');
  expect(root.style.getPropertyValue('--pptx-shell-background')).toBe('');
});
