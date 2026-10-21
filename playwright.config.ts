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
    // ORBIT_FAKE_AUDIO=1 uses Chromium's fake audio sink, whose clock runs even when the
    // machine's audio output is unavailable (observed on macOS after a restart).
    launchOptions: {
      args: [
        ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
        ...(process.env.ORBIT_FAKE_AUDIO ? ['--disable-audio-output'] : []),
      ],
    },
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
