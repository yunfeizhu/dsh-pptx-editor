import { expect, it, vi } from 'vitest';
import {
  createTable,
  updateTable,
  tableProjection,
  tableCreateSchema,
  tableUpdateSchema,
} from '../src/table-editing.js';
import { DocumentSession } from '../src/document-session.js';
import { runOperation } from '../src/document-operations.js';
import { operationSchema } from '../src/protocol.js';
import { operationFixture } from './operation-fixture.js';
import type { Element } from '../src/element-format.js';

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}

function table(): Extract<Element, { type: 'table' }> {
  return {
    id: 'table',
    type: 'table',
    x: 0,
    y: 0,
    width: 300,
    height: 120,
    tableData: createTable(
      {
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        style: { fontSize: 18, bold: false },
        firstRowHeader: true,
      },
      120,
    ),
  };
}
it('edits rich table cells without mutating snapshots or losing unrelated metadata', () => {
  const element = table();
  const cell = defined(defined(defined(element.tableData).rows[0]).cells[0]);
  cell.style = {
    colorRef: { scheme: 'accent1' },
    backgroundColorRef: { scheme: 'accent2' },
  };
  cell.textRuns = [{ text: 'A', italic: true, color: '#FF0000' }];
  cell.extraAttributes = { anchorCtr: '1' };
  const patch = updateTable(element, {
    kind: 'cells',
    cells: [
      {
        row: 0,
        column: 0,
        style: { bold: true, color: '#000000', backgroundColor: '#FFFFFF' },
      },
    ],
  });
  expect(
    'tableData' in patch && patch.tableData.rows[0]?.cells[0],
  ).toMatchObject({
    text: 'A',
    extraAttributes: { anchorCtr: '1' },
    style: { bold: true, color: '#000000', fillMode: 'solid' },
    textRuns: [{ text: 'A', italic: true, bold: true, color: '#000000' }],
  });
  expect(JSON.stringify(patch)).not.toContain('colorRef');
  expect(cell.textRuns[0]?.color).toBe('#FF0000');
  const replaced = updateTable(element, {
    kind: 'cells',
    cells: [{ row: 0, column: 0, text: '' }],
  });
  expect(
    'tableData' in replaced && replaced.tableData.rows[0]?.cells[0]?.textRuns,
  ).toBeUndefined();
  expect(() =>
    updateTable(element, {
      kind: 'cells',
      cells: [
        { row: 0, column: 0, text: 'changed' },
        { row: 5, column: 0, text: 'bad' },
      ],
    }),
  ).toThrow('out of range');
  expect(cell.text).toBe('A');
  expect(tableProjection(element)).toMatchObject({
    table: { rowCount: 2, columnCount: 2, truncated: false },
  });
  const empty = { ...element };
  delete empty.tableData;
  expect(tableProjection(empty)).toEqual({});
});

it('inserts/deletes table rows and columns and resizes with normalized widths', () => {
  let element = table();
  const apply = (input: unknown) => {
    element = {
      ...element,
      ...updateTable(element, tableUpdateSchema.parse(input)),
    } as typeof element;
  };
  apply({ kind: 'insert-row', index: 1 });
  expect(element.tableData?.rows).toHaveLength(3);
  expect(element.height).toBe(180);
  apply({ kind: 'insert-column', index: 2 });
  expect(element.tableData?.columnWidths).toEqual([1 / 3, 1 / 3, 1 / 3]);
  apply({
    kind: 'layout',
    columnWidths: [1, 2, 1],
    rowHeights: [30, 40, 50],
    firstRowHeader: false,
    bandedRows: true,
    bandedColumns: false,
  });
  expect(element.height).toBe(120);
  expect(element.tableData?.columnWidths).toEqual([0.25, 0.5, 0.25]);
  apply({ kind: 'delete-row', index: 1 });
  apply({ kind: 'delete-column', index: 2 });
  expect(
    element.tableData?.rows.map((row) => row.cells.map((cell) => cell.text)),
  ).toEqual([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  expect(element.height).toBe(80);
  const { editor, commit } = operationFixture();
  const run = (change: object) =>
    runOperation(
      editor,
      operationSchema.parse({
        documentId: crypto.randomUUID(),
        version: 0,
        summary: 'Table',
        slideIndex: 0,
        ...change,
      }),
      commit,
    );
  const added = run({
    operation: 'add-table',
    x: 0,
    y: 0,
    width: 300,
    height: 120,
    table: {
      rows: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    },
  });
  run({
    operation: 'update-table',
    elementId: added.elementId,
    update: { kind: 'cells', cells: [{ row: 1, column: 1, text: '42' }] },
  });
  expect(
    tableProjection(defined(defined(editor.getSlides()[0]).elements.at(-1))),
  ).toMatchObject({
    table: {
      rows: [
        { cells: [{ text: 'A' }, { text: 'B' }] },
        { cells: [{ text: 'C' }, { text: '42' }] },
      ],
    },
  });
  editor.undo();
  expect(
    tableProjection(defined(defined(editor.getSlides()[0]).elements.at(-1))),
  ).toMatchObject({
    table: { rows: [{}, { cells: [{ text: 'C' }, { text: 'D' }] }] },
  });
  vi.mocked(editor.updateElement).mockImplementation(() => {});
  expect(() =>
    run({
      operation: 'update-table',
      elementId: added.elementId,
      update: { kind: 'cells', cells: [{ row: 1, column: 1, text: 'bad' }] },
    }),
  ).toThrow('read again');
});

it('rejects invalid or ambiguous table edits before invoking public mutations', () => {
  expect(() => createTable({ rows: [['A'], ['B', 'C']] }, 100)).toThrow(
    'equal',
  );
  expect(() =>
    updateTable(
      { id: 'x', type: 'text', x: 0, y: 0, width: 1, height: 1 },
      { kind: 'delete-row', index: 0 },
    ),
  ).toThrow('not an editable');
  for (const update of [
    {
      kind: 'cells',
      cells: [
        { row: 0, column: 0, text: 'a' },
        { row: 0, column: 0, text: 'b' },
      ],
    },
    { kind: 'layout', columnWidths: [1] },
    { kind: 'layout', rowHeights: [1] },
    { kind: 'delete-row', index: 5 },
  ])
    expect(() =>
      updateTable(table(), tableUpdateSchema.parse(update)),
    ).toThrow();
  const merged = table();
  defined(defined(defined(merged.tableData).rows[0]).cells[0]).gridSpan = 2;
  expect(() => updateTable(merged, { kind: 'insert-row', index: 0 })).toThrow(
    'unmerged',
  );
  defined(defined(defined(merged.tableData).rows[0]).cells[1]).hMerge = true;
  expect(() =>
    updateTable(merged, {
      kind: 'cells',
      cells: [{ row: 0, column: 1, text: 'x' }],
    }),
  ).toThrow('anchor');
  const single = { ...table(), tableData: createTable({ rows: [['a']] }, 100) };
  expect(() =>
    updateTable(single, { kind: 'delete-column', index: 0 }),
  ).toThrow('last');
  const full = {
    ...table(),
    tableData: createTable(
      { rows: [Array.from({ length: 30 }, () => '')] },
      100,
    ),
  };
  expect(() => updateTable(full, { kind: 'insert-column', index: 0 })).toThrow(
    'limit',
  );
  defined(full.tableData.rows[0]).cells.pop();
  expect(() => updateTable(full, { kind: 'delete-row', index: 0 })).toThrow(
    'dimensions',
  );
  expect(
    tableUpdateSchema.safeParse({
      kind: 'cells',
      cells: [{ row: 0, column: 0 }],
    }).success,
  ).toBe(false);
  expect(tableUpdateSchema.safeParse({ kind: 'layout' }).success).toBe(false);
  expect(tableCreateSchema.safeParse({ rows: [] }).success).toBe(false);
});

it('rejects non-persistable rich cell formatting and structural shifts, and bounds large reads', () => {
  const element = table();
  const cell = defined(element.tableData?.rows[0]?.cells[0]);
  cell.textRuns = [
    { text: 'A', color: '#000000' },
    { text: 'B', color: '#FF0000', bold: true },
  ];
  expect(
    tableCreateSchema.safeParse({
      rows: [['A']],
      style: { fontFamily: 'Arial' },
    }).success,
  ).toBe(false);
  expect(() =>
    updateTable(element, {
      kind: 'cells',
      cells: [{ row: 0, column: 0, style: { bold: true } }],
    }),
  ).toThrow('rich table');
  expect(() => updateTable(element, { kind: 'insert-row', index: 0 })).toThrow(
    'rich table',
  );
  expect(() =>
    updateTable(element, {
      kind: 'cells',
      cells: [{ row: 0, column: 0, style: { backgroundColor: '#123456' } }],
    }),
  ).not.toThrow();
  const large = {
    ...table(),
    tableData: createTable(
      {
        rows: Array.from({ length: 100 }, () =>
          Array.from({ length: 30 }, () => 'content'),
        ),
        style: { fontSize: 18, bold: true, backgroundColor: '#123456' },
      },
      1000,
    ),
  };
  const budget = { remaining: 32_000 };
  const first = tableProjection(large, budget);
  const second = tableProjection(large, budget);
  expect(first).toMatchObject({
    table: { rowCount: 100, columnCount: 30, truncated: true },
  });
  expect(second).toMatchObject({ table: { truncated: true } });
  expect(JSON.stringify([first, second]).length).toBeLessThan(34_000);
  cell.text = 'x'.repeat(2001);
  cell.textRuns = Array.from({ length: 17 }, () => ({
    text: 'y'.repeat(2001),
  }));
  expect(tableProjection(element)).toMatchObject({
    table: { truncated: true },
  });
});

it('keeps document identity, version and editing usable after creating a large styled table', () => {
  const { editor, commit } = operationFixture();
  const session = new DocumentSession(
    {
      name: 'synthetic.pptx',
      read: () => Promise.resolve(new Uint8Array([1])),
      write: async () => {},
    },
    new Uint8Array([1]),
    editor,
    commit,
  );
  const inserted = session.operate(
    operationSchema.parse({
      documentId: session.id,
      version: session.read().version,
      summary: 'Large table',
      operation: 'add-table',
      slideIndex: 0,
      x: 0,
      y: 0,
      width: 900,
      height: 1000,
      table: {
        rows: Array.from({ length: 100 }, () =>
          Array.from({ length: 30 }, () => 'row content'),
        ),
        style: {
          fontSize: 18,
          bold: true,
          color: '#123456',
          backgroundColor: '#FFFFFF',
          borderBottomColor: '#000000',
          borderBottomWidth: 2,
        },
      },
    }),
  );
  const state = session.read();
  expect(JSON.stringify(state).length).toBeLessThan(200_000);
  expect(state.documentId).toBe(session.id);
  const target = state.slides[0]?.elements.find(
    (el) => el.id === inserted.elementId,
  );
  expect(target).toMatchObject({ table: { truncated: true, rowCount: 100 } });
  const changed = session.operate(
    operationSchema.parse({
      documentId: session.id,
      version: state.version,
      summary: 'Edit visible cell',
      operation: 'update-table',
      slideIndex: 0,
      elementId: inserted.elementId,
      update: {
        kind: 'cells',
        cells: [{ row: 0, column: 0, text: 'Updated' }],
      },
    }),
  );
  expect(changed.status).toBe('applied');
});
