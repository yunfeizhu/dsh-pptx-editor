/** Copy presentation-independent DSH colors into a plugin-owned surface. */
export function syncShellTheme(
  source: Element | null,
  root: HTMLElement = document.documentElement,
): () => void {
  if (!source) return () => {};
  const tokens: Record<string, string> = {
    background: '--dsw-alias-bg-base',
    foreground: '--dsw-alias-label-primary',
    muted: '--dsw-alias-label-secondary',
    border: '--dsw-alias-border-l2',
    hover: '--dsw-alias-interactive-bg-hover',
    active: '--dsw-alias-interactive-bg-active',
    primary: '--dsw-alias-brand-primary',
    ring: '--dsw-alias-button-info-fill',
    destructive: '--dsw-alias-state-error-secondary',
  };
  const update = () => {
    const style = getComputedStyle(source);
    for (const [name, hostToken] of Object.entries(tokens)) {
      const value = style.getPropertyValue(hostToken).trim();
      const target = `--pptx-shell-${name}`;
      if (value) root.style.setProperty(target, value);
      else root.style.removeProperty(target);
    }
  };
  update();
  const observer = new MutationObserver(update);
  for (
    let element: Element | null = source;
    element;
    element = element.parentElement
  )
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  return () => {
    observer.disconnect();
    for (const name of Object.keys(tokens))
      root.style.removeProperty(`--pptx-shell-${name}`);
  };
}
