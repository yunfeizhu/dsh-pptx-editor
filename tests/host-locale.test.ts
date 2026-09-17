// @vitest-environment jsdom
import { createInstance } from 'i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { readHostLocale, syncHostLocale } from '../src/editor/host-locale.js';

afterEach(() => vi.restoreAllMocks());

it('uses browser language only when the host supplies none', () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
  expect(readHostLocale(null)).toBe('zh-CN');
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
  expect(readHostLocale(null)).toBe('en');
  const host = document.implementation.createHTMLDocument();
  host.documentElement.lang = 'ZH-cn';
  expect(readHostLocale(host.createElement('iframe'))).toBe('zh-CN');
});

it('follows host changes, rejects independent viewer locale changes and disposes listeners', async () => {
  const locale = createInstance();
  await locale.init({ lng: 'en', resources: { en: {}, 'zh-CN': {} } });
  syncHostLocale(null, locale)();
  const host = document.implementation.createHTMLDocument();
  host.documentElement.lang = 'zh-CN';
  const stop = syncHostLocale(host.createElement('iframe'), locale);
  expect(locale.language).toBe('zh-CN');
  await locale.changeLanguage('en');
  expect(locale.language).toBe('zh-CN');
  host.documentElement.lang = 'en';
  await Promise.resolve();
  expect(locale.language).toBe('en');
  stop();
  host.documentElement.lang = 'zh-CN';
  await Promise.resolve();
  expect(locale.language).toBe('en');
  await locale.changeLanguage('zh-CN');
  expect(locale.language).toBe('zh-CN');
});
