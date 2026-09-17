import { z } from 'zod';
import type { Element } from './element-format.js';

type Table = Extract<Element, { type: 'table' }>;
type Data = NonNullable<Table['tableData']>;
type Cell = Data['rows'][number]['cells'][number];
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const index = z.number().int().nonnegative();
export const cellStyleSchema = z.strictObject({
  fontSize: z
    .number()
    .positive()
    .max(300)
    .optional()
    .describe('Points, unlike text-box sizes which use pixels.'),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: color.optional(),
  backgroundColor: color.optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  vAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  marginLeft: z.number().min(0).max(500).optional(),
  marginRight: z.number().min(0).max(500).optional(),
  marginTop: z.number().min(0).max(500).optional(),
  marginBottom: z.number().min(0).max(500).optional(),
  borderTopColor: color.optional(),
  borderBottomColor: color.optional(),
  borderLeftColor: color.optional(),
  borderRightColor: color.optional(),
  borderTopWidth: z.number().min(0).max(20).optional(),
  borderBottomWidth: z.number().min(0).max(20).optional(),
  borderLeftWidth: z.number().min(0).max(20).optional(),
  borderRightWidth: z.number().min(0).max(20).optional(),
});
export const tableCreateSchema = z.strictObject({
  rows: z
    .array(z.array(z.string().max(2000)).min(1).max(30))
    .min(1)
    .max(100),
  firstRowHeader: z.boolean().optional(),
  style: cellStyleSchema.optional(),
});
export const tableUpdateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cells'),
    cells: z
      .array(
        z
          .strictObject({
            row: index,
            column: index,
            text: z.string().max(2000).optional(),
            style: cellStyleSchema.optional(),
          })
          .refine(
            (cell) =>
              cell.text !== undefined ||
              Object.keys(cell.style ?? {}).length > 0,
            'Empty cell edit',
          ),
      )
      .min(1)
      .max(3000),
  }),
  z.strictObject({
    kind: z.enum([
      'insert-row',
      'delete-row',
      'insert-column',
      'delete-column',
    ]),
    index,
  }),
  z
    .strictObject({
      kind: z.literal('layout'),
      columnWidths: z
        .array(z.number().positive())
        .min(1)
        .max(30)
        .optional()
        .describe('Relative widths; normalized to sum to one.'),
      rowHeights: z
        .array(z.number().positive().max(10000))
        .min(1)
        .max(100)
        .optional()
        .describe('Pixels, one per row.'),
      firstRowHeader: z.boolean().optional(),
      bandedRows: z.boolean().optional(),
      bandedColumns: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 1, 'Empty table layout'),
]);

function cleanStyle(
  style: z.infer<typeof cellStyleSchema>,
): NonNullable<Cell['style']> {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  );
}

export function createTable(
  input: z.infer<typeof tableCreateSchema>,
  height: number,
): Data {
  const columns = input.rows[0]?.length ?? 0;
  if (!columns || input.rows.some((row) => row.length !== columns))
    throw new Error('Table rows must have equal column counts');
  return {
    rows: input.rows.map((row) => ({
      height: height / input.rows.length,
      cells: row.map((text) => ({
        text,
        ...(input.style ? { style: cleanStyle(input.style) } : {}),
      })),
    })),
    columnWidths: Array.from({ length: columns }, () => 1 / columns),
    firstRowHeader: input.firstRowHeader ?? false,
  };
}

function cellEdit(
  cell: Cell,
  text: string | undefined,
  style: z.infer<typeof cellStyleSchema> | undefined,
) {
  if (cell.hMerge || cell.vMerge)
    throw new Error('Edit the anchor cell of a merged range');
  if (
    text === undefined &&
    (cell.textRuns?.length ?? 0) > 1 &&
    Object.keys(style ?? {}).some((key) =>
      ['fontSize', 'bold', 'italic', 'underline', 'color'].includes(key),
    )
  )
    throw new Error(
      'The released viewer cannot reliably save font changes in rich table cells without replacing their text',
    );
  if (text !== undefined) {
    cell.text = text;
    delete cell.textRuns;
  }
  if (!style) return;
  cell.style = { ...cell.style, ...cleanStyle(style) };
  if (style.color !== undefined) {
    delete cell.style.colorRef;
    delete cell.style.colorXml;
  }
  if (style.backgroundColor !== undefined) {
    delete cell.style.backgroundColorRef;
    delete cell.style.backgroundColorXml;
    cell.style.fillMode = 'solid';
  }
  // Rich runs win in the renderer; apply only explicitly requested run properties.
  if (cell.textRuns)
    cell.textRuns = cell.textRuns.map((run) => ({
      ...run,
      ...Object.fromEntries(
        Object.entries(style).filter(([key]) =>
          [
            'fontSize',
            'fontFamily',
            'bold',
            'italic',
            'underline',
            'color',
          ].includes(key),
        ),
      ),
    }));
}

export function updateTable(
  element: Element,
  input: z.infer<typeof tableUpdateSchema>,
): Partial<Element> {
  if (element.type !== 'table' || !element.tableData)
    throw new Error('Target is not an editable table');
  const data = structuredClone(element.tableData);
  const rows = data.rows.length;
  const columns = data.columnWidths.length;
  if (
    !rows ||
    !columns ||
    rows > 100 ||
    columns > 30 ||
    data.rows.some((row) => row.cells.length !== columns)
  )
    throw new Error('Unsupported table dimensions');
  if (input.kind === 'cells') {
    const keys = input.cells.map(
      (cell) => `${String(cell.row)}:${String(cell.column)}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new Error('Duplicate cell targets');
    for (const edit of input.cells) {
      const cell = data.rows[edit.row]?.cells[edit.column];
      if (!cell) throw new Error('Table cell out of range');
      cellEdit(cell, edit.text, edit.style);
    }
  } else if (input.kind === 'layout') {
    if (input.columnWidths) {
      if (input.columnWidths.length !== columns)
        throw new Error('Expected one width per column');
      const total = input.columnWidths.reduce((a, b) => a + b, 0);
      data.columnWidths = input.columnWidths.map((width) => width / total);
    }
    if (input.rowHeights) {
      if (input.rowHeights.length !== rows)
        throw new Error('Expected one height per row');
      data.rows.forEach((row, i) => {
        const height = input.rowHeights?.[i];
        if (height !== undefined) row.height = height;
      });
    }
    for (const key of [
      'firstRowHeader',
      'bandedRows',
      'bandedColumns',
    ] as const)
      if (input[key] !== undefined) data[key] = input[key];
  } else {
    if (
      data.rows.some((row) =>
        row.cells.some((cell) => (cell.textRuns?.length ?? 0) > 1),
      )
    )
      throw new Error(
        'The released viewer cannot preserve rich table cells during row/column changes',
      );
    if (
      data.rows.some((row) =>
        row.cells.some(
          (cell) =>
            cell.hMerge ||
            cell.vMerge ||
            (cell.gridSpan ?? 1) > 1 ||
            (cell.rowSpan ?? 1) > 1,
        ),
      )
    )
      throw new Error(
        'Row/column insertion and deletion require an unmerged table',
      );
    const rowOperation = input.kind.endsWith('row');
    const inserting = input.kind.startsWith('insert');
    const count = rowOperation ? rows : columns;
    if (input.index >= count + Number(inserting))
      throw new Error('Table index out of range');
    if (!inserting && count === 1)
      throw new Error('Cannot delete the last table row or column');
    if (inserting && count >= (rowOperation ? 100 : 30))
      throw new Error('Table size limit reached');
    if (rowOperation) {
      if (inserting)
        data.rows.splice(input.index, 0, {
          height: element.height / rows,
          cells: Array.from({ length: columns }, () => ({ text: '' })),
        });
      else data.rows.splice(input.index, 1);
    } else {
      for (const row of data.rows) {
        if (inserting) row.cells.splice(input.index, 0, { text: '' });
        else row.cells.splice(input.index, 1);
      }
      data.columnWidths.splice(
        input.index,
        inserting ? 0 : 1,
        ...(inserting ? [1 / columns] : []),
      );
      const total = data.columnWidths.reduce((a, b) => a + b, 0);
      data.columnWidths = data.columnWidths.map((width) => width / total);
    }
  }
  return {
    tableData: data,
    ...((input.kind !== 'cells' &&
      input.kind !== 'layout' &&
      input.kind.endsWith('row')) ||
    (input.kind === 'layout' && input.rowHeights)
      ? {
          height: data.rows.reduce(
            (sum, row) => sum + (row.height ?? element.height / rows),
            0,
          ),
        }
      : {}),
  };
}

export function tableProjection(
  element: Element,
  budget = { remaining: 96_000 },
) {
  if (element.type !== 'table' || !element.tableData) return {};
  const data = element.tableData;
  const result = {
    table: {
      rowCount: data.rows.length,
      columnCount: data.columnWidths.length,
      truncated:
        data.rows.length > 100 ||
        data.columnWidths.length > 30 ||
        data.rows.some((row) =>
          row.cells.some(
            (cell) =>
              cell.text.length > 2000 ||
              (cell.textRuns?.length ?? 0) > 16 ||
              cell.textRuns?.some((run) => run.text.length > 2000),
          ),
        ),
      columnWidths: data.columnWidths.slice(0, 30),
      firstRowHeader: data.firstRowHeader ?? false,
      bandedRows: data.bandedRows ?? false,
      bandedColumns: data.bandedColumns ?? false,
      rows: data.rows.slice(0, 100).map((row) => ({
        height: row.height ?? null,
        cells: row.cells.slice(0, 30).map((cell) => ({
          text: cell.text.slice(0, 2000),
          gridSpan: cell.gridSpan ?? 1,
          rowSpan: cell.rowSpan ?? 1,
          hMerge: cell.hMerge ?? false,
          vMerge: cell.vMerge ?? false,
          style: Object.fromEntries(
            Object.entries(cell.style ?? {}).filter(
              ([key, value]) =>
                key in cellStyleSchema.shape && value !== undefined,
            ),
          ),
          textRuns: (cell.textRuns ?? []).slice(0, 16).map((run) =>
            Object.fromEntries(
              Object.entries(run)
                .filter(
                  ([key, value]) =>
                    [
                      'text',
                      'fontFamily',
                      'fontSize',
                      'bold',
                      'italic',
                      'underline',
                      'color',
                    ].includes(key) && value !== undefined,
                )
                .map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value.slice(0, 2000) : value,
                ]),
            ),
          ),
        })),
      })),
    },
  };
  let size = JSON.stringify(result).length;
  while (result.table.rows.length && size > budget.remaining) {
    const removed = result.table.rows.pop();
    size -= JSON.stringify(removed).length + 1;
    result.table.truncated = true;
  }
  budget.remaining = Math.max(
    0,
    budget.remaining - JSON.stringify(result).length,
  );
  return result;
}
