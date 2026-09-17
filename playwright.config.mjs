import { defineConfig } from '@playwright/test';
import { createFixture } from './tests/e2e/fixture.mjs';

await createFixture();
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: process.env.PPTX_TEST_FILE ? '*.manual.mjs' : '*.spec.mjs',
  workers: 1,
  timeout: 60_000,
  use: {
    channel: process.env.CI ? undefined : 'chrome',
    baseURL: 'http://127.0.0.1:3093',
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:3093/dsh-pptx/',
    reuseExistingServer: false,
  },
});
