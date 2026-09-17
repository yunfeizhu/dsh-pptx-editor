import { expect, it } from 'vitest';
import {
  createChart,
  updateChart,
  chartProjection,
  chartCreateSchema,
  chartUpdateSchema,
} from '../src/chart-editing.js';
import { runOperation } from '../src/document-operations.js';
import { operationSchema, replySchema } from '../src/protocol.js';
import { operationFixture } from './operation-fixture.js';
import type { Element } from '../src/element-format.js';

const source = () => ({
  chartType: 'bar' as const,
  title: 'Metrics',
  categories: ['Q1', 'Q2'],
  series: [{ name: 'Revenue', values: [10, 20] }],
});
function chart(): Extract<Element, { type: 'chart' }> {
  return {
    id: 'chart',
    type: 'chart',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    chartData: createChart(source()),
  };
}
it('creates supported chart families with complete data, valid JSON and bounded projections', () => {
  for (const chartType of [
    'bar',
    'line',
    'pie',
    'doughnut',
    'area',
    'radar',
  ] as const) {
    const data = createChart({
      ...source(),
      chartType,
      categories: ['Q1', 'Q2'],
      series: [
        {
          name: 'Series',
          values: [10, 20],
          color: '#000000',
        },
      ],
      style: { hasLegend: true },
    });
    expect(data.style?.hasTitle).toBe(true);
    const projected = chartProjection({ ...chart(), chartData: data });
    expect(replySchema.safeParse({ ok: true, value: projected }).success).toBe(
      true,
    );
    expect(projected).toMatchObject({ chart: { chartType, truncated: false } });
  }
  expect(chartProjection(chart())).toMatchObject({
    chart: {
      series: [{ color: null, xValues: null, bubbleSizes: null }],
      style: {},
    },
  });
  expect(createChart({ ...source(), title: '' }).style?.hasTitle).toBe(false);
  const empty = chart();
  delete empty.chartData;
  expect(chartProjection(empty)).toEqual({});
  const huge = {
    ...chart(),
    chartData: {
      ...source(),
      categories: Array.from({ length: 1001 }, () => 'x'),
    },
  };
  expect(chartProjection(huge)).toMatchObject({ chart: { truncated: true } });
});
it('preserves unrelated data during title/style changes and replaces requested series explicitly', () => {
  const element = {
    ...chart(),
    chartData: {
      ...source(),
      titleRuns: [{ text: 'Old' }],
      categoryLevels: [['old']],
      dateCategories: { formatCode: 'date', values: [1, 2] },
      style: { hasLegend: true },
    },
  };
  const patch = updateChart(element, {
    title: 'Changed',
    style: { hasLegend: false },
  });
  expect(patch).toMatchObject({
    chartData: {
      title: 'Changed',
      style: { hasLegend: false, hasTitle: true },
      series: source().series,
    },
  });
  expect(JSON.stringify(patch)).not.toContain('titleRuns');
  expect(element.chartData.titleRuns).toHaveLength(1);
  const changed = updateChart(chart(), {
    chartType: 'line',
    categories: ['A', 'B'],
    series: [{ name: 'Updated', values: [30, 40] }],
    grouping: 'stacked',
    barDirection: 'bar',
  });
  expect(changed).toMatchObject({
    chartData: {
      chartType: 'line',
      series: [{ name: 'Updated', values: [30, 40] }],
    },
  });
  expect(chartUpdateSchema.safeParse({}).success).toBe(false);
  expect(
    chartCreateSchema.safeParse({ ...source(), chartType: 'unknown' }).success,
  ).toBe(false);
});
it('fails closed on invalid point counts, unsupported imported charts and missing targets', () => {
  for (const data of [
    { ...source(), categories: [] },
    { ...source(), series: [] },
    { ...source(), series: [{ name: 'bad', values: [1] }] },
    {
      ...source(),
      chartType: 'pie' as const,
      series: [...source().series, ...source().series],
    },
  ])
    expect(() => createChart(data)).toThrow();
  const invalid = chart();
  delete invalid.chartData;
  expect(() => updateChart(invalid, { title: 'X' })).toThrow('editable');
  expect(() =>
    updateChart(
      { ...chart(), chartData: { ...source(), chartType: 'combo' } },
      { title: 'X' },
    ),
  ).toThrow('UI');
  expect(() => updateChart(chart(), { categories: ['one'] })).toThrow(
    'one value',
  );
});
it('uses one live update and undo for an existing chart', () => {
  const { editor, commit } = operationFixture();
  const run = (input: object) =>
    runOperation(
      editor,
      operationSchema.parse({
        documentId: crypto.randomUUID(),
        version: 0,
        summary: 'Chart test',
        slideIndex: 0,
        ...input,
      }),
      commit,
    );
  const inserted = run({
    operation: 'add-chart',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    chart: source(),
  });
  run({
    operation: 'update-chart',
    elementId: inserted.elementId,
    update: { series: [{ name: 'Revenue', values: [42, 60] }] },
  });
  expect(editor.updateElement).toHaveBeenCalledOnce();
  const current = () =>
    editor.getSlides()[0]?.elements.find((el) => el.id === inserted.elementId);
  expect(current()).toMatchObject({
    chartData: { series: [{ values: [42, 60] }] },
  });
  editor.undo();
  expect(current()).toMatchObject({
    chartData: { series: [{ values: [10, 20] }] },
  });
});

it('rejects imported category and scatter-data changes that the released serializer cannot persist', () => {
  const imported = {
    ...chart(),
    chartData: { ...source(), chartPartPath: 'ppt/charts/chart1.xml' },
  };
  expect(() => updateChart(imported, { categories: ['A', 'B'] })).toThrow(
    'category changes',
  );
  expect(() =>
    updateChart(imported, { categories: ['Q1', 'Q2'], title: 'Safe' }),
  ).not.toThrow();
  expect(() =>
    updateChart(
      {
        ...imported,
        chartData: { ...imported.chartData, chartType: 'scatter' },
      },
      { series: source().series },
    ),
  ).toThrow('UI');
});

it('rejects serializer gaps before any chart mutation and budgets large chart reads', () => {
  for (const chartType of ['scatter', 'bubble'])
    expect(
      chartCreateSchema.safeParse({ ...source(), chartType }).success,
    ).toBe(false);
  for (const style of [
    { hasTitle: false },
    { hasGridlines: false },
    { chartAreaFill: '#123456' },
    { plotAreaFill: '#123456' },
  ])
    expect(chartUpdateSchema.safeParse({ style }).success).toBe(false);
  const imported = {
    ...chart(),
    chartData: {
      ...source(),
      chartPartPath: 'chart.xml',
      barDirection: 'col' as const,
    },
  };
  for (const patch of [
    { chartType: 'line' as const },
    { grouping: 'stacked' as const },
    { barDirection: 'bar' as const },
  ])
    expect(() => updateChart(imported, patch)).toThrow('cannot reliably save');
  expect(() =>
    updateChart(
      {
        ...imported,
        chartData: {
          ...imported.chartData,
          series: [{ name: 'Series', values: [1, 2], seriesChartType: 'line' }],
        },
      },
      { title: 'Changed' },
    ),
  ).toThrow('Combination');
  expect(chartProjection(imported, { remaining: 0 })).toMatchObject({
    chart: { truncated: true, categories: [], series: [] },
  });
});
