import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', viewport: { width: 360, height: 640 } },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
