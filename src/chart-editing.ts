import { z } from 'zod';
import type { Element } from './element-format.js';

type Data = NonNullable<Extract<Element, { type: 'chart' }>['chartData']>;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const chartTypeSchema = z.enum([
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'radar',
]);
const seriesSchema = z.strictObject({
  name: z.string().max(200),
  values: z.array(z.number()).min(1).max(1000),
  color: color.optional(),
});
const styleSchema = z.strictObject({
  hasLegend: z.boolean().optional(),
  legendPosition: z.enum(['t', 'b', 'l', 'r', 'tr']).optional(),
  hasDataLabels: z.boolean().optional(),
});
export const chartCreateSchema = z.strictObject({
  chartType: chartTypeSchema,
  title: z.string().max(500).optional(),
  categories: z
    .array(z.string().max(200))
    .max(1000)
    .describe('One category label per value in each series.'),
  series: z.array(seriesSchema).min(1).max(20),
  grouping: z.enum(['clustered', 'stacked', 'percentStacked']).optional(),
  barDirection: z.enum(['col', 'bar']).optional(),
  style: styleSchema.optional(),
});
export const chartUpdateSchema = chartCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Empty chart edit');

function defined<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function validate(data: Data) {
  if (!chartTypeSchema.safeParse(data.chartType).success)
    throw new Error(
      'This chart type cannot be reliably saved through conversation tools',
    );
  const count = data.categories.length;
  if (!count || count > 1000 || !data.series.length || data.series.length > 20)
    throw new Error('Chart size limit exceeded');
  if (data.series.some((series) => series.values.length !== count))
    throw new Error('Each series needs one value per category');
  if (['pie', 'doughnut'].includes(data.chartType) && data.series.length !== 1)
    throw new Error('Pie and doughnut charts require one series');
}

export function createChart(input: z.infer<typeof chartCreateSchema>): Data {
  const { series, style, ...rest } = input;
  const data: Data = {
    ...defined(rest),
    series: series.map(defined),
    style: { ...defined(style ?? {}), hasTitle: Boolean(input.title) },
  };
  validate(data);
  return data;
}

export function updateChart(
  element: Element,
  input: z.infer<typeof chartUpdateSchema>,
): Partial<Element> {
  if (element.type !== 'chart' || !element.chartData)
    throw new Error('Target is not an editable chart');
  const data = structuredClone(element.chartData);
  if (!chartTypeSchema.safeParse(data.chartType).success)
    throw new Error('Editing this imported chart type requires the viewer UI');
  if (
    data.series.some(
      (series) =>
        series.seriesChartType && series.seriesChartType !== data.chartType,
    )
  )
    throw new Error('Combination charts require the viewer UI');
  for (const key of ['chartType', 'grouping', 'barDirection'] as const)
    if (
      data.chartPartPath &&
      input[key] !== undefined &&
      input[key] !== data[key]
    )
      throw new Error(
        'The released viewer cannot reliably save imported chart type, grouping or direction changes. Create a new chart instead.',
      );
  const changedCategories =
    input.categories &&
    JSON.stringify(input.categories) !== JSON.stringify(data.categories);
  if (data.chartPartPath && changedCategories)
    throw new Error(
      'The released viewer cannot reliably save category changes in imported charts. Create a new chart with the desired categories instead.',
    );
  if (input.chartType !== undefined) data.chartType = input.chartType;
  if (input.title !== undefined) {
    data.title = input.title;
    delete data.titleRuns;
    data.style = { ...data.style, hasTitle: input.title.length > 0 };
  }
  if (input.categories && changedCategories) {
    data.categories = [...input.categories];
    delete data.categoryLevels;
    delete data.dateCategories;
  }
  // Replacing series is explicit. Do not retain old formulas, points or per-type caches.
  if (input.series) data.series = input.series.map(defined);
  if (input.grouping !== undefined) data.grouping = input.grouping;
  if (input.barDirection !== undefined) data.barDirection = input.barDirection;
  if (input.style) data.style = { ...data.style, ...defined(input.style) };
  validate(data);
  return { chartData: data };
}

export function chartProjection(
  element: Element,
  budget = { remaining: 96_000 },
) {
  if (element.type !== 'chart' || !element.chartData) return {};
  const data = element.chartData;
  const result = {
    chart: {
      chartType: data.chartType,
      title: data.title ?? '',
      categories: data.categories.slice(0, 1000),
      series: data.series.slice(0, 20).map((series) => ({
        name: series.name,
        values: series.values.slice(0, 1000),
        color: series.color ?? null,
        xValues: series.xValues?.slice(0, 1000) ?? null,
        bubbleSizes: series.bubbleSizes?.slice(0, 1000) ?? null,
      })),
      grouping: data.grouping ?? null,
      barDirection: data.barDirection ?? 'col',
      style: Object.fromEntries(
        Object.entries(data.style ?? {}).filter(
          ([key, value]) => key in styleSchema.shape && value !== undefined,
        ),
      ),
      truncated:
        data.categories.length > 1000 ||
        data.series.length > 20 ||
        data.series.some((series) => series.values.length > 1000),
    },
  };
  if (JSON.stringify(result).length > budget.remaining) {
    result.chart.categories = [];
    result.chart.series = [];
    result.chart.truncated = true;
  }
  budget.remaining = Math.max(
    0,
    budget.remaining - JSON.stringify(result).length,
  );
  return result;
}
