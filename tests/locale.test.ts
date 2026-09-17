import { expect, it } from 'vitest';
import { translationsEn } from 'pptx-react-viewer/i18n';
import { translationsZhCN as zh } from 'pptx-react-viewer/i18n/zh-CN';

it('supplies every published component key and preserves interpolation arguments', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(translationsEn).sort());
  const variables = (text: string) =>
    [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
      .map((match) => match[1])
      .sort();
  for (const [key, translation] of Object.entries(zh)) {
    expect({ key, nonempty: translation.length > 0 }).toEqual({
      key,
      nonempty: true,
    });
    expect({ key, variables: variables(translation) }).toEqual({
      key,
      variables: variables(translationsEn[key] ?? ''),
    });
  }
});
