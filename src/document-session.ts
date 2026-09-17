import type { PowerPointViewerAPI } from 'pptx-react-viewer';
import { tableProjection } from './table-editing.js';
import { chartProjection } from './chart-editing.js';
import {
  runOperation,
  insert,
  selectSlide,
  type OperationPort,
} from './document-operations.js';
import { imageProjection } from './image-editing.js';
import {
  MAX_FILE_BYTES,
  editSchema,
  batchEditSchema,
  type BatchEditInput,
  addSlideSchema,
  addTextSchema,
  operationSchema,
  insertImageSchema,
  type InsertImageInput,
  type OperationInput,
  type EditInput,
  type AddSlideInput,
  type AddTextInput,
} from './protocol.js';

import {
  elementPatch,
  formatProjection,
  formatText,
  plainSegments,
  type Element as PptxElement,
} from './element-format.js';

export type EditorPort = OperationPort &
  Pick<
    PowerPointViewerAPI,
    | 'getSlides'
    | 'getActiveSlideIndex'
    | 'getSelectedElementIds'
    | 'getMode'
    | 'updateElement'
    | 'updateElements'
    | 'addSlide'
    | 'addElement'
    | 'getContent'
  >;
export interface DocumentFile {
  readonly name: string;
  readonly needsDestination?: boolean;
  /** Select a destination under user activation and return its initial bytes once. */
  prepareWrite?: () => Promise<Uint8Array | undefined>;
  read: () => Promise<Uint8Array>;
  write: (bytes: Uint8Array) => Promise<void>;
}

// Native recovery serialization updates these source-package caches in place.
// Retain all other model fields, including nested XML in semantic properties.
function editableElementState(element: PptxElement): unknown {
  return {
    ...element,
    rawXml: undefined,
    shapeId: undefined,
    // Native table serialization materializes this default without a user edit.
    ...(element.type === 'table'
      ? { locks: { noGrouping: true, ...element.locks } }
      : {}),
    ...(element.type === 'group'
      ? { children: element.children.map(editableElementState) }
      : {}),
  };
}

/** A rejected precondition; no mutation was attempted for this request. */
export class StaleDocumentError extends Error {
  constructor() {
    super('Stale edit: read the document again');
    this.name = 'StaleDocumentError';
  }
}

/** The editor owns slides/history; this session validates edits and owns persistence. */
export class DocumentSession {
  readonly id = crypto.randomUUID();
  private version = 0;
  private fingerprint: string;
  private saved: string;
  private diskBytes: Uint8Array;
  private disposed = false;
  private saving = false;
  private editing = false;
  private unverifiedInteraction = false;
  lastEdit:
    | {
        id: string;
        status: 'applied' | 'failed';
      }
    | undefined;

  constructor(
    readonly file: DocumentFile,
    original: Uint8Array,
    private readonly editor: EditorPort,
    private readonly commit: (action: () => void) => void,
  ) {
    this.diskBytes = original.slice();
    this.fingerprint = this.serializeState();
    this.saved = this.fingerprint;
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Document closed');
    if (this.saving) throw new Error('Save in progress');
    if (this.editing) throw new Error('Batch edit in progress');
  }

  private serializeState(): string {
    return JSON.stringify(
      this.editor.getSlides().map((slide) => ({
        ...slide,
        // Save assigns archive IDs and page numbers in place. Requests target
        // the ordered slide index; retain element IDs and all semantic fields.
        id: undefined,
        slideNumber: undefined,
        rawXml: undefined,
        rId: undefined,
        elements: slide.elements.map(editableElementState),
      })),
    );
  }

  private refresh(): void {
    this.assertAvailable();
    const current = this.serializeState();
    if (current !== this.fingerprint) {
      this.fingerprint = current;
      this.invalidate();
    }
  }

  /** Conservative interaction fence until the editor exposes a reliable change feed. */
  invalidate(unverifiedInteraction = false): void {
    this.unverifiedInteraction ||= unverifiedInteraction;
    this.version += 1;
  }

  get dirty(): boolean {
    return this.unverifiedInteraction || this.serializeState() !== this.saved;
  }

  read() {
    this.refresh();
    const slides = this.editor.getSlides();
    const structuredBudget = { remaining: 128_000 };
    return {
      documentId: this.id,
      version: this.version,
      fileName: this.file.name,
      preview: {
        status: 'ready' as const,
        location: 'right-sidebar' as const,
        slideCount: slides.length,
      },
      readProjection: {
        included: [
          'element-text',
          'geometry',
          'text-format',
          'shape-format',
          'table-cell-values',
          'chart-series',
          'image-properties',
        ],
        excluded: ['speaker-notes', 'image-text'],
      },
      capabilities: {
        edit: [
          'text',
          'geometry',
          'font',
          'paragraph-alignment',
          'vertical-alignment',
          'spacing',
          'lists',
          'fill',
          'outline',
        ],
        operations: [
          'edit-batch',
          'navigate',
          'add-slide',
          'duplicate-slide',
          'delete-slide',
          'move-slide',
          'set-slide-hidden',
          'add-text',
          'add-shape',
          'add-table',
          'update-table',
          'add-chart',
          'update-chart',
          'add-image',
          'update-image',
          'duplicate-element',
          'delete-elements',
          'arrange-elements',
          'undo',
          'redo',
        ],
        unsupported: [
          'master-editing',
          'animation-authoring',
          'grouping',
          'layer-order',
        ],
        alignment:
          'Paragraph centering uses textStyle.align without changing the box. arrange-elements aligns unrotated element bounds within the selection, not the slide.',
        batchEditing:
          'edit_pptx_batch changes up to 100 distinct top-level elements across ordinary slides in one undo step. Supports edit_pptx patches; excludes slide creation/deletion and table/chart data operations. All targets are validated before mutation.',
      },
      selectedElementIds: this.editor.getSelectedElementIds(),
      history: {
        canUndo: this.editor.canUndo(),
        canRedo: this.editor.canRedo(),
      },
      activeSlideIndex: this.editor.getActiveSlideIndex(),
      lastEdit: this.lastEdit ?? null,
      slides: slides.map((slide, index) => ({
        index,
        id: slide.id,
        hidden: slide.hidden ?? false,
        elements: slide.elements.map((element) => ({
          id: element.id,
          type: element.type,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          text: 'text' in element ? (element.text ?? '') : null,
          ...formatProjection(element),
          ...tableProjection(element, structuredBudget),
          ...chartProjection(element, structuredBudget),
          ...imageProjection(element),
        })),
      })),
    };
  }

  private validateBase(edit: Pick<EditInput, 'documentId' | 'version'>): void {
    if (edit.documentId !== this.id || edit.version !== this.version) {
      throw new StaleDocumentError();
    }
    if (this.editor.getMode() !== 'edit')
      throw new Error('Switch to normal edit mode first');
  }

  private slideAt(slideIndex: number) {
    const slide = this.editor.getSlides()[slideIndex];
    if (!slide) throw new Error('Slide not found');
    return slide;
  }

  private validateTarget(edit: EditInput): PptxElement {
    this.validateBase(edit);
    this.slideAt(edit.slideIndex);
    const element = this.editor
      .getSlides()
      [edit.slideIndex]?.elements.find(
        (candidate) => candidate.id === edit.elementId,
      );
    if (!element) throw new Error('Element not found on this slide');
    return element;
  }

  applyEdit(input: EditInput) {
    this.refresh();
    const edit = editSchema.parse(input);
    const element = this.validateTarget(edit);
    const updates = elementPatch(element, edit.patch);
    return this.mutate((commit) => {
      selectSlide(this.editor, commit, edit.slideIndex);
      commit(() => {
        this.editor.updateElement(edit.elementId, updates);
      });
      const actual = this.editor
        .getSlides()
        [edit.slideIndex]?.elements.find(
          (candidate) => candidate.id === edit.elementId,
        );
      if (
        !actual ||
        Object.entries(updates).some(
          ([key, value]) =>
            JSON.stringify(Reflect.get(actual, key)) !== JSON.stringify(value),
        )
      ) {
        throw new Error('Editor did not apply the requested change');
      }
      return { slideIndex: edit.slideIndex, elementId: edit.elementId };
    });
  }

  async applyBatchEdit(input: BatchEditInput) {
    this.refresh();
    const change = batchEditSchema.parse(input);
    this.validateBase(change);
    // Build every patch before the public atomic call: a bad later target must
    // never apply an earlier edit. Resolve archive IDs from the live model.
    const updates = change.edits.map((edit) => ({
      slideId: this.slideAt(edit.slideIndex).id,
      elementId: edit.elementId,
      patch: elementPatch(
        this.validateTarget({ ...change, ...edit }),
        edit.patch,
      ),
    }));
    const id = crypto.randomUUID();
    this.editing = true;
    try {
      await this.editor.updateElements(updates, { label: change.summary });
      this.assertOpen();
      for (const update of updates) {
        const actual = this.editor
          .getSlides()
          .find((slide) => slide.id === update.slideId)
          ?.elements.find((element) => element.id === update.elementId);
        if (
          !actual ||
          Object.entries(update.patch).some(
            ([key, value]) =>
              JSON.stringify(Reflect.get(actual, key)) !==
              JSON.stringify(value),
          )
        )
          throw new Error(
            'Editor did not verify the entire batch; read again before retrying',
          );
      }
      const state = this.serializeState();
      const changed = state !== this.fingerprint;
      if (changed) {
        this.fingerprint = state;
        this.lastEdit = { id, status: 'applied' };
        this.version += 1;
      }
      return {
        id,
        status: changed ? ('applied' as const) : ('unchanged' as const),
        documentId: this.id,
        version: this.version,
        edits: change.edits.map(({ slideIndex, elementId }) => ({
          slideIndex,
          elementId,
        })),
        undoSteps: changed ? 1 : 0,
      };
    } catch (reason) {
      this.lastEdit = { id, status: 'failed' };
      this.invalidate();
      throw reason;
    } finally {
      this.editing = false;
    }
  }

  addImage(input: InsertImageInput) {
    this.refresh();
    const change = insertImageSchema.parse(input);
    this.validateBase(change);
    this.slideAt(change.slideIndex);
    return this.mutate((commit) =>
      insert(this.editor, commit, change.slideIndex, {
        id: crypto.randomUUID(),
        type: 'image',
        x: change.x,
        y: change.y,
        width: change.width,
        height: change.height,
        imageData: change.imageData,
        altText: change.altText ?? '',
      }),
    );
  }

  addSlide(input: AddSlideInput) {
    this.refresh();
    const change = addSlideSchema.parse(input);
    this.validateBase(change);
    const before = this.editor.getSlides().map((slide) => slide.id);
    const afterIndex = change.afterSlideIndex ?? before.length - 1;
    if (afterIndex < 0 || afterIndex >= before.length)
      throw new Error('Slide not found');
    const slideIndex = afterIndex + 1;
    return this.mutate((commit) => {
      // Always pass the insertion point: published default descriptions disagree.
      commit(() => {
        this.editor.addSlide(afterIndex);
      });
      const slides = this.editor.getSlides();
      const added = slides[slideIndex];
      if (
        !added ||
        slides.length !== before.length + 1 ||
        before.includes(added.id) ||
        this.editor.getActiveSlideIndex() !== slideIndex ||
        before.some(
          (id, index) =>
            slides[index < slideIndex ? index : index + 1]?.id !== id,
        )
      )
        throw new Error(
          'Editor did not insert the requested slide; read again before retrying',
        );
      return { slideIndex, slideId: added.id, slideCount: slides.length };
    });
  }

  addText(input: AddTextInput) {
    this.refresh();
    const change = addTextSchema.parse(input);
    this.validateBase(change);
    const slide = this.slideAt(change.slideIndex);
    const before = slide.elements.map((element) => element.id);
    const { text, x, y, width, height } = change;
    const textStyle = {
      fontSize: change.fontSize ?? 24,
      color: change.color ?? '#000000',
      bold: change.bold ?? false,
    };
    const element: Extract<PptxElement, { type: 'text' }> = {
      type: 'text',
      id: crypto.randomUUID(),
      text,
      x,
      y,
      width,
      height,
      textStyle,
      textSegments: plainSegments(text, textStyle),
    };
    if (change.textStyle)
      Object.assign(element, formatText(element, change.textStyle));
    return this.mutate((commit) => {
      selectSlide(this.editor, commit, change.slideIndex);
      let elementId: string | undefined;
      commit(() => {
        elementId = this.editor.addElement(element);
      });
      const elements = this.editor.getSlides()[change.slideIndex]?.elements;
      const added = elements?.find((candidate) => candidate.id === elementId);
      if (
        !elementId ||
        before.includes(elementId) ||
        !added ||
        added.type !== 'text' ||
        elements?.length !== before.length + 1 ||
        before.some((id, index) => elements[index]?.id !== id) ||
        Object.entries({ text, x, y, width, height }).some(
          ([key, value]) => Reflect.get(added, key) !== value,
        )
      )
        throw new Error(
          'Editor did not insert the requested text; read again before retrying',
        );
      return { slideIndex: change.slideIndex, elementId };
    });
  }

  operate(input: OperationInput) {
    this.refresh();
    const change = operationSchema.parse(input);
    this.validateBase(change);
    return this.mutate((commit) => runOperation(this.editor, change, commit));
  }

  private mutate<T extends object>(
    operation: (commit: (action: () => void) => void) => T,
  ) {
    const id = crypto.randomUUID();
    const attempt = { started: false };
    let target: T;
    try {
      target = operation((action) => {
        // Once a public mutation is attempted, an exception may leave partial
        // state. Pure validation failures must not consume the request version.
        attempt.started = true;
        this.commit(action);
      });
    } catch (reason) {
      if (attempt.started) {
        this.lastEdit = { id, status: 'failed' };
        this.invalidate();
      }
      throw reason;
    }
    this.lastEdit = { id, status: 'applied' };
    this.fingerprint = this.serializeState();
    this.version += 1;
    return {
      id,
      status: 'applied' as const,
      documentId: this.id,
      version: this.version,
      ...target,
    };
  }

  async save(): Promise<void> {
    this.refresh();
    this.saving = true;
    try {
      if (this.file.prepareWrite) {
        const baseline = await this.file.prepareWrite();
        this.assertOpen();
        if (baseline) this.diskBytes = baseline.slice();
      }
      const capturedVersion = this.version;
      const bytes = await this.editor.getContent();
      this.assertOpen();
      if (this.version !== capturedVersion)
        throw new Error('Document changed during save; try again');
      // Export may normalize OOXML fields in the public slide model.
      const captured = this.serializeState();
      if (!bytes.length || bytes.length > MAX_FILE_BYTES)
        throw new Error('Invalid or oversized export');
      const current = await this.file.read();
      if (
        current.length !== this.diskBytes.length ||
        current.some((byte, index) => byte !== this.diskBytes[index])
      ) {
        throw new Error(
          'The original file changed outside this editor. Reopen it before saving',
        );
      }
      this.assertOpen();
      await this.file.write(bytes);
      this.diskBytes = bytes.slice();
      this.saved = captured;
      this.unverifiedInteraction = false;
    } finally {
      this.saving = false;
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Document closed');
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
}
