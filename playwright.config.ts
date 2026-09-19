import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3100', channel: process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'npm run dev -- --port 3100',
    env: { AUTOPOST_TEST_SCOPE: 'browser', AUTOPOST_BUILD_DIR: '.next-e2e', ANTHROPIC_API_KEY: '' },
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
