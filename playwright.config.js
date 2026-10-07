import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    browserName: 'chromium',
  },
  webServer: {
    command: 'python3 -m http.server 4187 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
  },
});
