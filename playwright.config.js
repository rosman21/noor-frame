// Browser tests for the phone companion (and how it works with the screens). They run against
// e2e/server.mjs: the real API with every outside service faked. `npm run test:e2e`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8790;

export default defineConfig({
  testDir: 'e2e',
  // One shared test server, reset before each test, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Most households scan the QR code with an iPhone (Safari = WebKit) or an Android phone.
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/server.mjs',
      url: `http://localhost:${PORT}/api/config`,
      env: { E2E_PORT: String(PORT) },
      reuseExistingServer: !process.env.CI,
    },
    // The Raspberry Pi kiosk helper, in front of the test server (e2e/pi.spec.js). Without
    // NetworkManager here it simply reports no Wi-Fi.
    {
      command: 'node e2e/pi-helper.mjs',
      url: 'http://localhost:8798/kiosk/status',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
