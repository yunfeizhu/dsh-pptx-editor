export const CLOSE_EDITOR = 'dsh-pptx:close-editor';
export const RESUME_EDITOR = 'dsh-pptx:resume-editor';
export interface CloseState {
  dirty: boolean;
  fileName: string;
  released?: Promise<void>;
}
export interface CloseRequest {
  respond: (state: CloseState) => void;
}

/** A retained or collapsed iframe is not an opened preview. */
export function isEditorVisible(frame: Element | null): boolean {
  if (!frame) return true;
  const rect = frame.getBoundingClientRect();
  const viewport = frame.ownerDocument.documentElement;
  return (
    frame.checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
    }) &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.clientHeight &&
    rect.left < viewport.clientWidth
  );
}

const barrierKey = Symbol.for('dsh-pptx-viewer.connection-barrier.v1');
const closedKey = Symbol.for('dsh-pptx-viewer.editor-closed.v1');

/** Remember tab closure even before the editor script has loaded. */
export function isEditorClosed(frame: Element | null): boolean {
  return frame ? Reflect.get(frame, closedKey) === true : false;
}

export function resumeEditor(frame: HTMLIFrameElement): void {
  Reflect.set(frame, closedKey, false);
  frame.dispatchEvent(new Event(RESUME_EDITOR));
}

/** New frames must wait until the previous owner finishes releasing its lease. */
export function deferEditorConnection(
  frame: HTMLIFrameElement,
  released: Promise<void>,
): void {
  Reflect.set(frame, barrierKey, released);
}

export function previousEditorRelease(
  frame: Element | null,
): Promise<void> | undefined {
  return frame
    ? (Reflect.get(frame, barrierKey) as Promise<void> | undefined)
    : undefined;
}

/** Same-origin DOM handshake; closing must synchronously stop Agent commands. */
export function inspectClosingEditor(frame: HTMLIFrameElement): CloseState {
  Reflect.set(frame, closedKey, true);
  let result: CloseState = { dirty: true, fileName: 'PPTX' };
  frame.dispatchEvent(
    new CustomEvent<CloseRequest>(CLOSE_EDITOR, {
      detail: {
        respond: (state) => {
          result = state;
        },
      },
    }),
  );
  return result;
}
