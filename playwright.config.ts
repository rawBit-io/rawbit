import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3041';
const serverUrl = new URL(baseURL);
const serverHost = serverUrl.hostname || '127.0.0.1';
const serverPort = serverUrl.port || (serverUrl.protocol === 'https:' ? '443' : '80');
const reuseExistingServer =
  !process.env.CI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== '0';
const webServerEnv: Record<string, string> = {};

for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') {
    webServerEnv[key] = value;
  }
}
webServerEnv.VITE_API_BASE_URL =
  process.env.PLAYWRIGHT_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:5007';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    colorScheme: 'light',
    extraHTTPHeaders: process.env.CF_ACCESS_CLIENT_ID
      ? {
          'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET ?? '',
        }
      : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host ${serverHost} --port ${serverPort}`,
    url: baseURL,
    reuseExistingServer,
    env: webServerEnv,
    timeout: 2 * 60 * 1000,
  },
});
