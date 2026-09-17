import { confirmAction } from './confirm-action.js';
import { readHostLocale } from './editor/host-locale.js';
import { syncShellTheme } from './editor/shell-theme.js';

const messages = {
  'zh-CN': {
    title: '文稿已保留',
    description: '修改仍保留在当前网页，可以继续编辑。',
    restore: '继续编辑',
    discard: '丢弃修改',
    dismiss: '隐藏提示',
    close: '返回对话',
    recovery: '恢复文稿',
    confirm: '丢弃未保存的修改？',
    consequence: '将关闭保留的编辑器，请先导出需要保留的修改。',
    cancel: '取消',
  },
  en: {
    title: 'Presentation retained',
    description:
      'Your changes are still in this page. Continue editing anytime.',
    restore: 'Continue editing',
    discard: 'Discard changes',
    dismiss: 'Hide notice',
    close: 'Back to conversation',
    recovery: 'Recover presentation',
    confirm: 'Discard unsaved changes?',
    consequence:
      'This closes the retained editor. Export any changes you want to keep first.',
    cancel: 'Cancel',
  },
};

/** Host-owned recovery feedback; document state stays in the parked iframe. */
export function createPanelRecovery() {
  const root = document.createElement('div');
  root.className = 'pptx-panel-recovery';
  const style = document.createElement('style');
  style.textContent = `
    .pptx-panel-recovery { display: contents; }
    .pptx-recovery-notice, .pptx-recovery-overlay {
      box-sizing: border-box; color: var(--pptx-shell-foreground, #0f1115);
      background: var(--pptx-shell-background, #fff);
      font: 13px/1.5 system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .pptx-recovery-notice[hidden], .pptx-recovery-overlay[hidden] { display: none; }
    .pptx-recovery-notice {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      width: min(352px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto;
      padding: 16px; border: 1px solid var(--pptx-shell-border, #0000001a);
      border-radius: 10px; box-shadow: 0 4px 20px #00000014;
      scrollbar-width: thin; scrollbar-color: var(--pptx-shell-muted, #666b73) transparent;
    }
    .pptx-recovery-notice h2, .pptx-recovery-notice p { margin: 0; padding: 0; overflow-wrap: anywhere; }
    .pptx-recovery-notice h2 { padding-right: 28px; font: inherit; font-size: 14px; font-weight: 600; }
    .pptx-recovery-notice p { margin-top: 6px; color: var(--pptx-shell-muted, #666b73); }
    .pptx-recovery-notice .pptx-recovery-file { color: var(--pptx-shell-foreground, #0f1115); }
    .pptx-panel-recovery button {
      box-sizing: border-box; min-height: 34px; padding: 6px 12px; margin: 0;
      font: inherit; font-weight: 500; color: var(--pptx-shell-foreground, #0f1115);
      background: var(--pptx-shell-background, #fff); border: 1px solid var(--pptx-shell-border, #0000001a);
      border-radius: 10px; cursor: pointer;
    }
    .pptx-panel-recovery button:hover { background: var(--pptx-shell-hover, #0000000a); }
    .pptx-panel-recovery button:active { background: var(--pptx-shell-active, #0000000f); }
    .pptx-panel-recovery button:focus-visible { outline: 2px solid var(--pptx-shell-ring, #4176e6); outline-offset: 2px; }
    .pptx-panel-recovery button:disabled { opacity: .5; cursor: default; }
    .pptx-panel-recovery button[data-kind='quiet'] { border-color: transparent; background: transparent; }
    .pptx-panel-recovery button[data-kind='quiet']:hover { background: var(--pptx-shell-hover, #0000000a); }
    .pptx-recovery-notice footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .pptx-panel-recovery .pptx-recovery-dismiss {
      position: absolute; top: 8px; right: 8px; width: 32px; min-height: 32px; padding: 0; font-size: 20px; font-weight: 400;
    }
    .pptx-recovery-overlay { position: fixed; inset: 0; z-index: 2147483645; display: flex; flex-direction: column; }
    .pptx-recovery-overlay header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--pptx-shell-border, #0000001a); }
    .pptx-recovery-overlay header span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
    .pptx-recovery-overlay header button { flex: none; }
    .pptx-recovery-overlay > iframe { flex: 1 1 0; min-height: 0; }
    @media (forced-colors: active) { .pptx-panel-recovery button { border-color: ButtonText; } }
  `;
  const notice = document.createElement('div');
  notice.className = 'pptx-recovery-notice';
  notice.hidden = true;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-atomic', 'true');
  const title = document.createElement('h2');
  const file = document.createElement('p');
  file.className = 'pptx-recovery-file';
  const description = document.createElement('p');
  status.append(title, file, description);
  const restore = document.createElement('button');
  const discard = document.createElement('button');
  discard.dataset.kind = 'quiet';
  const dismiss = document.createElement('button');
  dismiss.className = 'pptx-recovery-dismiss';
  dismiss.dataset.kind = 'quiet';
  dismiss.textContent = '×';
  dismiss.onclick = () => {
    notice.hidden = true;
  };
  const actions = document.createElement('footer');
  actions.append(discard, restore);
  notice.append(status, dismiss, actions);

  const overlay = document.createElement('div');
  overlay.className = 'pptx-recovery-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'region');
  const header = document.createElement('header');
  const name = document.createElement('span');
  const close = document.createElement('button');
  header.append(name, close);
  overlay.append(header);
  for (const button of [restore, discard, dismiss, close])
    button.type = 'button';
  root.append(style, notice, overlay);
  document.body.append(root);
  const stopTheme = syncShellTheme(document.body, root);
  const copy = () => messages[readHostLocale(root)];
  const localize = () => {
    const text = copy();
    title.textContent = text.title;
    description.textContent = text.description;
    restore.textContent = text.restore;
    discard.textContent = text.discard;
    dismiss.setAttribute('aria-label', text.dismiss);
    close.textContent = text.close;
    overlay.setAttribute('aria-label', text.recovery);
  };
  localize();
  const observer = new MutationObserver(localize);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
  return {
    notice,
    overlay,
    restore,
    discard,
    close,
    setFileName(fileName: string) {
      file.textContent = fileName;
      name.textContent = fileName;
    },
    async confirmDiscard() {
      if (discard.disabled) return false;
      discard.disabled = true;
      const text = copy();
      try {
        return await confirmAction(text.confirm, text.discard, text.cancel, {
          description: `${file.textContent} — ${text.consequence}`,
          themeSource: root,
        });
      } finally {
        discard.disabled = false;
      }
    },
    dispose() {
      observer.disconnect();
      stopTheme();
      root.remove();
    },
  };
}
