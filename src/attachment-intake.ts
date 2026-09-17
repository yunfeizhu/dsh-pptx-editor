import type { AttachmentIntent } from './attachments.js';
import type { AttachmentWatchState } from './chat-attachments.js';
import { isPanelDismissed, setPanelDismissed } from './panel-dismissal.js';

const key = Symbol.for('dsh-pptx-editor.attachments.v1');
const changed = 'dsh-pptx-editor:attachment';
const navigatedKey = Symbol.for('dsh-pptx-editor.attachment-navigation.v2');
const reopenKey = Symbol.for('dsh-pptx-editor.panel-open.v1');
const reopenChanged = 'dsh-pptx-editor:panel-open';
const watchedKey = Symbol.for('dsh-pptx-editor.attachment-watch.v1');

/** History admission, like the editor itself, survives client-module reloads. */
export function attachmentWatchState(doc: Document): AttachmentWatchState {
  let state = Reflect.get(doc, watchedKey) as AttachmentWatchState | undefined;
  if (!state) {
    state = { seen: new Map(), reopened: new Map() };
    Reflect.set(doc, watchedKey, state);
  }
  return state;
}
function registry(doc: Document): Map<string, AttachmentIntent> {
  let value = Reflect.get(doc, key) as
    Map<string, AttachmentIntent> | undefined;
  if (!value) {
    value = new Map();
    Reflect.set(doc, key, value);
  }
  return value;
}

/** Share metadata across the native tab and its isolated editor, without copying document bodies. */
export function publishAttachment(
  doc: Document,
  sessionId: string,
  intent: AttachmentIntent,
  source: 'restore' | 'new' = 'new',
): void {
  if (source === 'new' && registry(doc).get(sessionId)?.key !== intent.key)
    setPanelDismissed(doc, sessionId, false);
  registry(doc).set(sessionId, intent);
  doc.dispatchEvent(new Event(changed));
}

export function observeAttachment(
  doc: Document,
  sessionId: string,
  receive: (intent: AttachmentIntent) => void,
): () => void {
  let seen: AttachmentIntent | undefined;
  const update = () => {
    const intent = registry(doc).get(sessionId);
    if (!intent || intent === seen) return;
    seen = intent;
    receive(intent);
  };
  doc.addEventListener(changed, update);
  update();
  return () => {
    doc.removeEventListener(changed, update);
  };
}

/** A successful navigation survives composer remounts and explicit tab closes. */
export function navigateAttachmentOnce(
  doc: Document,
  sessionId: string,
  intent: AttachmentIntent,
  open: () => void,
): void {
  if (isPanelDismissed(doc, sessionId)) return;
  const navigated =
    (Reflect.get(doc, navigatedKey) as Map<string, Set<string>> | undefined) ??
    new Map<string, Set<string>>();
  Reflect.set(doc, navigatedKey, navigated);
  const opened = navigated.get(sessionId) ?? new Set<string>();
  if (opened.has(intent.key)) return;
  open();
  opened.add(intent.key);
  navigated.set(sessionId, opened);
}

/** Keep explicit reopen requests separate from attachment replacement. */
export function requestPanelOpen(
  doc: Document,
  sessionId: string,
  id: string,
): void {
  const requests =
    (Reflect.get(doc, reopenKey) as Map<string, string> | undefined) ??
    new Map<string, string>();
  Reflect.set(doc, reopenKey, requests);
  if (requests.get(sessionId) === id) return;
  setPanelDismissed(doc, sessionId, false);
  requests.set(sessionId, id);
  doc.dispatchEvent(new Event(reopenChanged));
}

export function observePanelOpen(
  doc: Document,
  sessionId: string,
  receive: (id: string) => void,
): () => void {
  let seen: string | undefined;
  const update = () => {
    const id = (
      Reflect.get(doc, reopenKey) as Map<string, string> | undefined
    )?.get(sessionId);
    if (!id || id === seen) return;
    seen = id;
    receive(id);
  };
  doc.addEventListener(reopenChanged, update);
  update();
  return () => {
    doc.removeEventListener(reopenChanged, update);
  };
}
