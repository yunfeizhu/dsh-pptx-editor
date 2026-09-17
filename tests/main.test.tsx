// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  render: vi.fn(),
  root: vi.fn(),
}));
vi.mock('react-dom/client', () => ({
  createRoot: mock.root.mockReturnValue({ render: mock.render }),
}));
vi.mock('i18next', () => ({ default: { use: () => ({ init: mock.init }) } }));
vi.mock('react-i18next', () => ({ initReactI18next: {} }));
vi.mock('pptx-react-viewer/i18n', () => ({ translationsEn: { test: 'Test' } }));
vi.mock('pptx-react-viewer/styles', () => ({}));
vi.mock('../src/editor/App.js', () => ({ App: () => null }));
afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it('uses the surrounding host language before mounting', async () => {
  const host = document.implementation.createHTMLDocument();
  host.documentElement.lang = 'en';
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(
    host.createElement('iframe'),
  );
  document.body.innerHTML = '<div id="root"></div>';
  await import('../src/editor/main.js');
  expect(mock.init).toHaveBeenCalledWith(
    expect.objectContaining({ lng: 'en' }),
  );
});
it('boots the isolated editor with its session and component translations', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  location.hash = '#session%2Fone';
  const host = document.implementation.createHTMLDocument();
  host.documentElement.lang = 'zh-CN';
  vi.spyOn(window, 'frameElement', 'get').mockReturnValue(
    host.createElement('iframe'),
  );
  await import('../src/editor/main.js');
  expect(mock.init).toHaveBeenCalledWith(
    expect.objectContaining({
      lng: 'zh-CN',
      resources: {
        en: { translation: { test: 'Test' } },
        'zh-CN': {
          translation: expect.objectContaining({
            'pptx.ribbon.home': '开始',
          }) as unknown,
        },
      },
    }),
  );
  expect(mock.root).toHaveBeenCalledWith(document.getElementById('root'));
  expect(mock.render).toHaveBeenCalledWith(
    expect.objectContaining({ props: { sessionId: 'session/one' } }),
  );
});
it('fails explicitly when its mount container is missing', async () => {
  await expect(import('../src/editor/main.js')).rejects.toThrow(
    'Editor root missing',
  );
  expect(mock.root).not.toHaveBeenCalled();
});
