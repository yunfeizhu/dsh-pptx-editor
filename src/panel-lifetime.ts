import { BASE_PATH } from './protocol.js';
import {
  deferEditorConnection,
  inspectClosingEditor,
  resumeEditor,
} from './editor-lifecycle.js';
import { setPanelDismissed } from './panel-dismissal.js';
import { createPanelRecovery } from './panel-recovery.js';

interface Entry {
  frame: HTMLIFrameElement;
  parking: HTMLDivElement;
  notice: HTMLDivElement;
  overlay: HTMLDivElement;
  owner: AbortSignal;
  recovery?: ReturnType<typeof createPanelRecovery>;
}
// Client modules can reload while DSH tab records and their signals stay alive.
// Keep the editor registry on the page so a replacement module adopts the same frames.
const registryKey = Symbol.for('dsh-pptx-editor.panel-registry.v1');
const frames =
  (Reflect.get(document, registryKey) as Map<string, Entry> | undefined) ??
  new Map<string, Entry>();
Reflect.set(document, registryKey, frames);
const closingKey = Symbol.for('dsh-pptx-editor.closing-connections.v1');
const closing =
  (Reflect.get(document, closingKey) as
    Map<string, Promise<void>> | undefined) ?? new Map<string, Promise<void>>();
Reflect.set(document, closingKey, closing);
function move(parent: HTMLDivElement, frame: HTMLIFrameElement): void {
  (
    parent as HTMLDivElement & {
      moveBefore: (node: Node, reference: Node | null) => void;
    }
  ).moveBefore(frame, null);
}
function recoveryView(entry: Entry): ReturnType<typeof createPanelRecovery> {
  if (!entry.recovery) {
    // Upgrade legacy UI without detaching or reloading its retained editor.
    move(entry.parking, entry.frame);
    entry.notice.remove();
    entry.overlay.remove();
    entry.recovery = createPanelRecovery();
    entry.notice = entry.recovery.notice;
    entry.overlay = entry.recovery.overlay;
  }
  return entry.recovery;
}
function drop(sessionId: string, entry: Entry, released?: Promise<void>): void {
  if (frames.get(sessionId) !== entry) return;
  frames.delete(sessionId);
  // Keep the browsing context alive until fetch cleanup has finished.
  move(entry.parking, entry.frame);
  entry.notice.remove();
  entry.overlay.remove();
  entry.recovery?.dispose();
  const remove = () => {
    entry.frame.remove();
    entry.parking.remove();
  };
  if (!released) {
    remove();
    return;
  }
  const done = released
    .catch(() => undefined)
    .then(() => {
      remove();
      if (closing.get(sessionId) === done) closing.delete(sessionId);
    });
  closing.set(sessionId, done);
}
function retainClosed(sessionId: string, entry: Entry): void {
  const state = inspectClosingEditor(entry.frame);
  if (!state.fileName) {
    drop(sessionId, entry, state.released);
    return;
  }
  move(entry.parking, entry.frame);
  entry.overlay.hidden = true;
  if (!state.dirty) {
    entry.notice.hidden = true;
    return;
  }
  entry.notice.hidden = false;
  const recovery = recoveryView(entry);
  recovery.setFileName(state.fileName);
  recovery.restore.onclick = () => {
    entry.notice.hidden = true;
    entry.overlay.hidden = false;
    move(entry.overlay, entry.frame);
    recovery.close.focus();
  };
  recovery.discard.onclick = async () => {
    const owner = entry.owner;
    if (await recovery.confirmDiscard()) {
      if (entry.owner === owner && owner.aborted)
        drop(sessionId, entry, state.released);
    }
  };
}

/** DSH tab bodies may unmount; a closed unsaved editor remains recoverable. */
export function attachPanel(
  host: HTMLDivElement,
  sessionId: string,
  signal: AbortSignal,
): () => void {
  if (signal.aborted) return () => {};
  if (!('moveBefore' in Element.prototype))
    throw new Error(
      'Use a current Chrome or Edge browser / 请使用最新版 Chrome 或 Edge',
    );
  let entry = frames.get(sessionId);
  const bind = !entry || entry.owner !== signal;
  if (entry && entry.owner !== signal && !entry.owner.aborted)
    throw new Error('A PPTX tab already owns this conversation');
  if (!entry) {
    const frame = document.createElement('iframe');
    const released = closing.get(sessionId);
    if (released) deferEditorConnection(frame, released);
    frame.title = 'PPTX editor / 演示文稿编辑器';
    frame.src = `${BASE_PATH}/#${encodeURIComponent(sessionId)}`;
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    frame.allow = 'clipboard-read; clipboard-write; fullscreen';
    const parking = document.createElement('div');
    parking.hidden = true;
    const recovery = createPanelRecovery();
    const { notice, overlay } = recovery;
    document.body.append(parking);
    parking.append(frame);
    entry = { frame, parking, notice, overlay, recovery, owner: signal };
    frames.set(sessionId, entry);
  }
  const owned = entry;
  // A legacy owner's abort callback still owns its old DOM. Upgrade only after
  // that owner closes; otherwise its callback can destroy the new controls.
  if (owned.recovery || bind) {
    const recovery = recoveryView(owned);
    recovery.close.onclick = () => {
      retainClosed(sessionId, owned);
      recovery.restore.focus();
    };
  }
  owned.owner = signal;
  owned.notice.hidden = true;
  owned.overlay.hidden = true;
  if (bind)
    signal.addEventListener(
      'abort',
      () => {
        if (frames.get(sessionId) === owned && owned.owner === signal) {
          setPanelDismissed(document, sessionId, true);
          retainClosed(sessionId, owned);
        }
      },
      { once: true },
    );
  // appendChild would reload an iframe; moveBefore preserves its editor and undo history.
  move(host, owned.frame);
  resumeEditor(owned.frame);
  setPanelDismissed(document, sessionId, false);
  return () => {
    if (!signal.aborted && owned.frame.parentNode === host)
      move(owned.parking, owned.frame);
  };
}
