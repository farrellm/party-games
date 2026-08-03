import { defineConfig, devices } from '@playwright/test';

// Deliberately not Vite's 5173: reusing whatever happens to be on the default
// port silently tests someone else's app.
const PORT = 5199;
const BASE = `http://localhost:${PORT}/party-games/`;

/*
 * These run against the dev server rather than a preview build, so specs can
 * import the real source modules and drive them directly. DESIGN.md §13.1 is a
 * question about browser engines, not about bundling — and `npm run build`
 * guards bundling separately in CI.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Only Chromium takes camera as a context permission; Firefox wants a
        // pref and WebKit grants it by default under automation.
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            // Without this, two contexts on one machine only ever gather mDNS
            // candidates and cannot resolve each other's names.
            '--force-webrtc-ip-handling-policy=default',
          ],
        },
      },
    },
    {
      // §13.1 names Chrome, Firefox and iOS Safari as the three engines that
      // disagree at the SDP margins. Playwright's WebKit is not iOS Safari,
      // but it is the same engine, and it catches what a Chrome-only check
      // cannot.
      //
      // Its Linux build needs Ubuntu system libraries, so `npm run e2e` skips
      // it and CI runs `npm run e2e:all` on ubuntu-latest instead.
      name: 'webkit',
      use: devices['Desktop Safari'],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'permissions.default.camera': 1,
          },
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
