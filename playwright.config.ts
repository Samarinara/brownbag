import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx tests/support/preview.ts',
    url: 'http://127.0.0.1:3001',
    timeout: 60000,
  },
});
