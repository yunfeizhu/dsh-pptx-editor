/** Keep destructive confirmation in the page with native modal focus management. */
export function confirmAction(
  message: string,
  action: string,
  cancel: string,
  options: { description?: string; themeSource?: Element } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'pptx-confirm';
    const theme = getComputedStyle(
      options.themeSource ?? document.documentElement,
    );
    for (const name of Array.from(theme))
      if (name.startsWith('--pptx-'))
        dialog.style.setProperty(name, theme.getPropertyValue(name));
    dialog.style.colorScheme = theme.colorScheme;
    const style = document.createElement('style');
    style.textContent = `
      dialog.pptx-confirm {
        position: fixed; inset: 0; margin: auto; box-sizing: border-box;
        width: min(420px, calc(100vw - 32px)); height: fit-content;
        max-height: calc(100dvh - 32px); overflow: auto;
        background: var(--pptx-shell-background, Canvas); color: var(--pptx-shell-foreground, CanvasText);
        border: 1px solid var(--pptx-shell-border, GrayText); border-radius: var(--pptx-shell-radius, 10px);
        padding: 24px; box-shadow: 0 24px 72px #0005;
        font: 13px/1.6 system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      }
      dialog.pptx-confirm::backdrop { background: #0008; }
      .pptx-confirm h2 { margin: 0; padding: 0; font: inherit; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
      .pptx-confirm p { margin: 10px 0 0; padding: 0; color: var(--pptx-shell-muted, GrayText); overflow-wrap: anywhere; }
      .pptx-confirm footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
      .pptx-confirm button { box-sizing: border-box; min-height: 34px; margin: 0; padding: 6px 12px;
        font: inherit; font-weight: 500; cursor: pointer; border-radius: var(--pptx-shell-radius, 10px);
        color: var(--pptx-shell-foreground, ButtonText); background: var(--pptx-shell-background, ButtonFace);
        border: 1px solid var(--pptx-shell-border, ButtonBorder); }
      .pptx-confirm button[data-action='accept'] { border-color: var(--pptx-shell-border, ButtonText); }
      .pptx-confirm button:hover { background: var(--pptx-shell-hover, Highlight); }
      .pptx-confirm button:active { border-color: var(--pptx-shell-border, ButtonText); }
      .pptx-confirm button:focus-visible { outline: 2px solid var(--pptx-shell-ring, Highlight); outline-offset: 2px; }
      @media (forced-colors: active) { .pptx-confirm button { border-color: ButtonText; } }
    `;
    const label = document.createElement('h2');
    label.id = `pptx-confirm-${crypto.randomUUID()}`;
    label.textContent = message;
    dialog.setAttribute('aria-labelledby', label.id);
    const dismiss = document.createElement('button');
    const accept = document.createElement('button');
    dismiss.textContent = cancel;
    accept.textContent = action;
    accept.dataset.action = 'accept';
    const finish = (accepted: boolean) => {
      window.removeEventListener('keydown', handleKeyDown, true);
      dialog.close();
      dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
      resolve(accepted);
    };
    dismiss.onclick = () => {
      finish(false);
    };
    accept.onclick = () => {
      finish(true);
    };
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    // Viewer overlays capture keys on document; the top-layer dialog owns its keys first.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !dialog.contains(event.target))
        return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        finish(false);
      }
    };
    const actions = document.createElement('footer');
    actions.append(dismiss, accept);
    dialog.append(style, label);
    if (options.description) {
      const description = document.createElement('p');
      description.id = `${label.id}-description`;
      description.textContent = options.description;
      dialog.setAttribute('aria-describedby', description.id);
      dialog.append(description);
    }
    dialog.append(actions);
    document.body.append(dialog);
    window.addEventListener('keydown', handleKeyDown, true);
    dialog.showModal();
    dismiss.focus();
  });
}
