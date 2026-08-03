import { defineConfig, devices } from '@playwright/test';

// The suite drives real WebRTC between two browser contexts, so it needs a real
// Chromium and a served build — not jsdom.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/party-games/',
    permissions: ['camera'],
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            // Keep ICE on real loopback candidates instead of mDNS, so the
            // two contexts can actually reach each other on one machine.
            '--force-webrtc-ip-handling-policy=default',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/party-games/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
