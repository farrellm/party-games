/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/party-games/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Party Games',
        short_name: 'Party',
        start_url: '/party-games/',
        scope: '/party-games/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0D1220',
        theme_color: '#0D1220',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2 is not in the design doc's list, but the app self-hosts its typeface;
        // without it the first offline load falls back to a system font.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 4_000_000,
        navigateFallback: '/party-games/index.html',
      },
    }),
  ],
  server: {
    // Bind every interface, not just loopback, so the dev server can be
    // reached from a phone on the same WiFi — which is the only way to test
    // the QR handshake and the real WebRTC transport (§13.1).
    host: true,
    // Vite refuses Host headers it does not recognise, as DNS-rebinding
    // protection. Reaching the dev server under this name needs it listed.
    allowedHosts: ['farrellm23.duckdns.org'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
