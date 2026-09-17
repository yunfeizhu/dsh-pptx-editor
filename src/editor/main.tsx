import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translationsEn } from 'pptx-react-viewer/i18n';
import { readHostLocale } from './host-locale.js';
import { translationsZhCN } from 'pptx-react-viewer/i18n/zh-CN';
import 'pptx-react-viewer/styles';
import './styles.css';
import { App } from './App.js';

await i18n.use(initReactI18next).init({
  lng: readHostLocale(window.frameElement),
  fallbackLng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: translationsEn },
    'zh-CN': { translation: translationsZhCN },
  },
});
const container = document.getElementById('root');
if (!container) throw new Error('Editor root missing');
createRoot(container).render(
  <App sessionId={decodeURIComponent(location.hash.slice(1))} />,
);
