import { test, expect } from '@playwright/test';

test('an explicit tab close survives refresh until a new open request', async ({
  page,
}) => {
  await page.goto('/test/panel?session=closed-refresh&restore=1');
  const connected = page
    .frameLocator('iframe')
    .locator('.pptx-connection[data-state="connected"]');
  await expect(connected).toBeAttached();
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open tab', exact: true }),
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Reopen through conversation', exact: true })
    .click();
  await expect(connected).toBeAttached();
  await page.reload();
  await expect(connected).toBeAttached();
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.reload();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Send new attachment', exact: true })
    .click();
  await expect(connected).toBeAttached();
});

test('refresh releases the previous page without reporting a second editor', async ({
  page,
}) => {
  await page.goto('/test/panel?session=refresh-owner');
  const editor = page.frameLocator('iframe');
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.reload();
    await expect(
      editor.locator('.pptx-connection[data-state="connected"]'),
    ).toBeAttached({ timeout: 5000 });
    await expect(editor.getByRole('alert')).toHaveCount(0);
  }
});

test('connection recovery is quiet when healthy and keeps Retry stable while reconnecting', async ({
  page,
}) => {
  const resume = Promise.withResolvers();
  let claims = 0;
  let failExchange = true;
  await page.route('**/dsh-pptx/claim', async (route) => {
    claims += 1;
    if (claims > 1) await resume.promise;
    await route.continue();
  });
  await page.route('**/dsh-pptx/exchange', async (route) => {
    if (failExchange) {
      failExchange = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto('/test/panel?session=retry-control');
  const editor = page.frameLocator('iframe');
  await expect(
    editor.getByText('对话连接已断开', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByText('Agent 已连接', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    editor.getByRole('combobox', { name: 'Language / 语言' }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole('button', { name: '重试', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'DSH English', exact: true }).click();
  const retry = editor.getByRole('button', { name: 'Retry', exact: true });
  await expect(
    editor.getByText('Chat connection lost', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 420, height: 720 });
  const before = await retry.boundingBox();
  await retry.press('Enter');
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveAttribute('aria-busy', 'true');
  expect(await retry.boundingBox()).toEqual(before);
  await expect(editor.locator('.pptx-bar')).toHaveCount(0);
  await page.screenshot({ path: '.cache/retry-narrow.png' });
  resume.resolve();
  await expect(editor.locator('.pptx-connection')).toHaveAttribute(
    'data-state',
    'connected',
  );
  await expect(editor.locator('.pptx-connection')).toBeHidden();
  await expect(retry).toHaveCount(0);
  await expect(
    editor.getByRole('button', { name: 'Open PPTX', exact: true }).first(),
  ).toBeFocused();
  expect(claims).toBe(2);
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('closing before the editor script starts keeps recovery paused until the tab reopens', async ({
  page,
}) => {
  const loading = Promise.withResolvers();
  const finishLoading = Promise.withResolvers();
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/claim')) claims += 1;
  });
  await page.route('**/dsh-pptx/editor.js', async (route) => {
    loading.resolve();
    await finishLoading.promise;
    await route.continue();
  });
  await page.goto('/test/panel?session=close-before-start', {
    waitUntil: 'domcontentloaded',
  });
  await loading.promise;
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  finishLoading.resolve();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  const editor = page.frameLocator('iframe');
  await expect(editor.getByText('恢复视图', { exact: true })).toBeVisible();
  expect(claims).toBe(0);
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open tab', exact: true }).click();
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  expect(claims).toBe(1);
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('closing and immediately reopening an empty editor releases its previous owner', async ({
  page,
}) => {
  await page.goto('/test/panel?session=empty-reopen');
  const editor = page.frameLocator('iframe');
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByRole('button', { name: 'Close tab', exact: true }).click();
    await page.getByRole('button', { name: 'Open tab', exact: true }).click();
    await expect(
      editor.locator('.pptx-connection[data-state="connected"]'),
    ).toBeAttached({ timeout: 4_000 });
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(
      editor.getByRole('button', { name: '打开 PPTX', exact: true }),
    ).toBeVisible();
    await expect(editor.getByRole('switch')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('a replacement waits for delayed release, while independent editors still conflict', async ({
  page,
  context,
}) => {
  const releasing = Promise.withResolvers();
  const finishRelease = Promise.withResolvers();
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/claim')) claims += 1;
  });
  await page.route('**/dsh-pptx/release', async (route) => {
    releasing.resolve();
    await finishRelease.promise;
    await route.continue();
  });
  await page.goto('/test/panel?session=delayed-release');
  const editor = page.locator('section').frameLocator('iframe');
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await releasing.promise;
  await page.getByRole('button', { name: 'Open tab', exact: true }).click();
  await expect(
    editor.locator('.pptx-connection[data-state="connecting"]'),
  ).toBeAttached();
  expect(claims).toBe(1);
  finishRelease.resolve();
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  expect(claims).toBe(2);
  await expect(page.locator('iframe')).toHaveCount(1);
  const other = await context.newPage();
  await other.goto('/test/panel?session=delayed-release');
  const otherEditor = other.frameLocator('iframe');
  await expect(otherEditor.getByRole('alert')).toContainText(
    'already has an editor',
    { timeout: 25_000 },
  );
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await otherEditor.getByRole('button', { name: '重试', exact: true }).click();
  await expect(
    otherEditor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  await other.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(other.locator('iframe')).toHaveCount(0);
  await other.close();
});

test('closing during a claim releases the host lease before its replacement connects', async ({
  page,
}) => {
  const claimed = Promise.withResolvers();
  const finishClaim = Promise.withResolvers();
  let first = true;
  await page.route('**/dsh-pptx/claim', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    claimed.resolve();
    await finishClaim.promise;
    await route.fulfill({ response });
  });
  await page.goto('/test/panel?session=close-during-claim');
  await claimed.promise;
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.getByRole('button', { name: 'Open tab', exact: true }).click();
  const editor = page.locator('section').frameLocator('iframe');
  await expect(
    editor.locator('.pptx-connection[data-state="connecting"]'),
  ).toBeAttached();
  finishClaim.resolve();
  await expect(
    editor.locator('.pptx-connection[data-state="connected"]'),
  ).toBeAttached();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});
