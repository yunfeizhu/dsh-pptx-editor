const stateKey = Symbol.for('dsh-pptx-viewer.panel-dismissal.v1');
const storagePrefix = 'dsh-pptx-viewer.panel-dismissed.v1:';
const storageProbe = 'dsh-pptx-viewer.panel-dismissed.storage-probe.v1';

interface PageState {
  dismissed: Map<string, boolean>;
  leaving: boolean;
}

function pageState(doc: Document): PageState {
  let state = Reflect.get(doc, stateKey) as PageState | undefined;
  if (!state) {
    state = { dismissed: new Map(), leaving: false };
    Reflect.set(doc, stateKey, state);
    const owned = state;
    doc.defaultView?.addEventListener('pagehide', () => {
      owned.leaving = true;
    });
    doc.defaultView?.addEventListener('pageshow', () => {
      owned.leaving = false;
    });
  }
  return state;
}

/** Remember navigation only, scoped to this browser tab and DSH conversation. */
export function isPanelDismissed(doc: Document, sessionId: string): boolean {
  const { dismissed } = pageState(doc);
  let value = dismissed.get(sessionId);
  if (value === undefined) {
    try {
      const storage = doc.defaultView?.sessionStorage;
      // Quota and read-only failures can leave reads working but lose close writes.
      storage?.setItem(storageProbe, '1');
      storage?.removeItem(storageProbe);
      value = storage?.getItem(storagePrefix + sessionId) === '1';
    } catch {
      // If storage is blocked, do not surprise the user with history navigation.
      value = true;
    }
    dismissed.set(sessionId, value);
  }
  return value;
}

export function setPanelDismissed(
  doc: Document,
  sessionId: string,
  dismissed: boolean,
): void {
  const state = pageState(doc);
  // Browser teardown must not turn an open panel into an explicit dismissal.
  if (state.leaving) return;
  state.dismissed.set(sessionId, dismissed);
  try {
    const storage = doc.defaultView?.sessionStorage;
    if (dismissed) storage?.setItem(storagePrefix + sessionId, '1');
    else storage?.removeItem(storagePrefix + sessionId);
  } catch {
    // Explicit opens still work in memory when browser storage is unavailable.
  }
}
