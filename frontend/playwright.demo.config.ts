/** End-to-end run against the static demo build, served from a sub-path. */
import { defineConfig, devices } from '@playwright/test';

const BASE_PATH = process.env.VITE_BASE ?? '/atrium-demo/';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:4174${BASE_PATH}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  // One browser at a time: the projects run sequentially.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, dependencies: ['chromium'] },
  ],
  // Pages-faithful: a static server with no SPA fallback (deep links must work on their own).
  webServer: {
    command: `VITE_BASE=${BASE_PATH} npm run build:demo && node scripts/serve-static.mjs dist-demo ${BASE_PATH} 4174`,
    url: `http://127.0.0.1:4174${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
