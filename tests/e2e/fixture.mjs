import PptxGenJS from 'pptxgenjs';
import { mkdir } from 'node:fs/promises';

export async function createFixture() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Synthetic test fixture';
  const cover = pptx.addSlide();
  cover.background = { color: 'F8FAFC' };
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 4.8,
    h: 7.5,
    fill: { color: '4F46E5' },
    line: { color: '4F46E5' },
  });
  cover.addText('Project Atlas', {
    x: 0.5,
    y: 2.3,
    w: 4,
    h: 1.5,
    color: 'FFFFFF',
    fontSize: 42,
    bold: true,
  });
  cover.addText('Synthetic presentation', {
    x: 0.5,
    y: 4.3,
    w: 4,
    h: 0.6,
    color: 'E0E7FF',
    fontSize: 18,
  });
  cover.addShape(pptx.ShapeType.roundRect, {
    x: 6,
    y: 2,
    w: 2,
    h: 2,
    fill: { color: '818CF8' },
    radius: 0.2,
  });
  cover.addNotes('Synthetic speaker notes');
  const details = pptx.addSlide();
  details.addText('Quarterly plan', {
    x: 0.6,
    y: 0.4,
    w: 8,
    h: 0.7,
    fontSize: 30,
    bold: true,
  });
  details.addTable(
    [
      ['Quarter', 'Target'],
      ['Q1', '10'],
      ['Q2', '20'],
    ],
    {
      x: 0.6,
      y: 1.5,
      w: 5,
      h: 2,
      border: { type: 'solid', color: 'D1D5DB', pt: 1 },
      fontSize: 16,
    },
  );
  details.addChart(
    pptx.ChartType.bar,
    [{ name: 'Growth', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 30] }],
    {
      x: 6.6,
      y: 1.5,
      w: 5.4,
      h: 3.5,
      catAxisLabelFontSize: 14,
      valAxisLabelFontSize: 12,
    },
  );
  details.addImage({
    data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    x: 0.6,
    y: 5,
    w: 1,
    h: 1,
  });
  await mkdir('.cache', { recursive: true });
  await pptx.writeFile({ fileName: '.cache/synthetic.pptx' });
}
