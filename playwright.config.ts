import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5431',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    // Headless Chrome on macOS is far smoother on Metal than SwiftShader.
    launchOptions: { args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5431',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, launchOptions: {} },
      testIgnore: /perf/,
    },
  ],
})
