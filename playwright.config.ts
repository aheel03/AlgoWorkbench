import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', fullyParallel: false,
  use: { baseURL: process.env.E2E_PRODUCTION ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:5173', headless: true, screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined } },
  webServer: { command: process.env.E2E_PRODUCTION ? 'node server/index.js' : (process.platform === 'win32' ? 'npm.cmd run dev' : 'npm run dev'), url: process.env.E2E_PRODUCTION ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
