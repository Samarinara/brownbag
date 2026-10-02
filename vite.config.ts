import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'Brownbag — Your recipes',
        short_name: 'Brownbag',
        description: 'Your recipes. All in one bag.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f5ee',
        theme_color: '#466542',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Cookbook', url: '/cookbook' },
          { name: 'Meal Planner', url: '/meal-planner' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/mcp(?:\/|$)/,
          /^\/health$/,
          /^\/oauth-client-metadata\.json$/,
          /^\/jwks\.json$/,
          /^\/\.well-known\//,
        ],
        // Only the static shell is cached. Private APIs and OAuth remain network-only.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { allowedHosts: ['pokeball'] },
  build: { outDir: 'dist/client' },
});
