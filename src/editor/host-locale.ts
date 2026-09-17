import type { i18n } from 'i18next';

/** DSH publishes its active locale through the host document's HTML lang. */
export function readHostLocale(frame: Element | null): 'zh-CN' | 'en' {
  const language =
    frame?.ownerDocument.documentElement.lang || navigator.language;
  return language.toLowerCase().split('-')[0] === 'zh' ? 'zh-CN' : 'en';
}

/** Keep the isolated editor and component on the host locale without remounting. */
export function syncHostLocale(
  frame: Element | null,
  locale: i18n,
): () => void {
  if (!frame) return () => {};
  const update = () => {
    const next = readHostLocale(frame);
    if (locale.language !== next) void locale.changeLanguage(next);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(frame.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
  // Viewer preferences must not replace the surrounding application's language.
  locale.on('languageChanged', update);
  return () => {
    observer.disconnect();
    locale.off('languageChanged', update);
  };
}
