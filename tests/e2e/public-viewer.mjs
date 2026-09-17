import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { PowerPointViewer } from 'pptx-react-viewer';
import { translationsEn } from 'pptx-react-viewer/i18n';
import 'pptx-react-viewer/styles';

await i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  keySeparator: false,
  resources: { en: { translation: translationsEn } },
});
const bytes = new Uint8Array(
  await (await fetch('/test/fixture')).arrayBuffer(),
);
const ref = createRef();
// Test-only mount of the released public ref; no private viewer state is accessed.
window.viewerCall = (method, args = []) => {
  let result;
  flushSync(() => {
    result = ref.current[method](...args);
  });
  return result;
};
createRoot(document.getElementById('root')).render(
  React.createElement(PowerPointViewer, {
    ref,
    content: bytes,
    fileName: 'public-api.pptx',
    canEdit: true,
    autosave: false,
  }),
);
