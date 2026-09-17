import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Exercise the native viewer UI; only the OS file picker is adapted.
export async function openViewerFile(editor) {
  const emptyOpen = editor.getByRole('button', {
    name: /^(打开 PPTX|Open PPTX)$/,
  });
  const fileTab = editor.getByRole('tab', { name: /^(文件|File)$/ });
  await expect(emptyOpen.or(fileTab)).toBeVisible();
  if (await emptyOpen.count()) {
    await emptyOpen.click();
    return;
  }
  await fileTab.click();
  const backstage = editor.getByRole('dialog', { name: /^(文件|File)$/ });
  await backstage.getByRole('button', { name: /^(打开|Open)$/ }).click();
  await backstage
    .getByRole('button', { name: /^(浏览此设备|Browse this device)$/ })
    .click();
}

export async function downloadPptx(page, editor) {
  const downloading = page.waitForEvent('download');
  await editor
    .getByRole('button', { name: /^(保存|Save)$/ })
    .first()
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  return new Uint8Array(await readFile(path));
}

export async function reopenPptx(page, editor, bytes, name = 'synthetic.pptx') {
  await editor.locator('body').evaluate(
    (_, value) => {
      window.showOpenFilePicker = async () => [
        {
          name: value.name,
          getFile: async () =>
            new File([new Uint8Array(value.bytes)], value.name),
          createWritable: async () => {
            throw new Error(
              'Native download must not overwrite the opened file',
            );
          },
        },
      ];
    },
    { bytes: [...bytes], name },
  );
  await openViewerFile(editor);
  const confirmation = editor.locator('dialog.pptx-confirm');
  if (await confirmation.count()) {
    await confirmation
      .getByRole('button', { name: /^(放弃修改并打开|Discard and open)$/ })
      .click();
  }
  await expect(
    editor.getByRole('switch', { name: /^(切换自动保存|Toggle autosave)$/ }),
  ).toBeEnabled();
}
