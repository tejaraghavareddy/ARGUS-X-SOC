import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' keeps asset URLs relative so the built bundle works from any
// static file server (or file:// where supported) without a CDN.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
    strictPort: false,
    // Vite 5.4.12+ blocks requests with an unrecognized Host header
    // (CVE-2025-24010 hardening). The managed preview is reached through a
    // generated <port>-<id>.e2b.app hostname, so the host cannot be
    // hard-coded here; allow the dynamic preview host for this local dev server.
    allowedHosts: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
