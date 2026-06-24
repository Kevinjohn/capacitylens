import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@floaty/shared': fileURLToPath(new URL('./shared/src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Bind IPv4 loopback explicitly. Node 17+ resolves `localhost` to `::1` (IPv6)
  // first, so the default Vite host would listen on `::1` only and any browser/tool
  // reaching `127.0.0.1` gets connection-refused (blank page, no console error).
  // Pinning 127.0.0.1 keeps it loopback-only while staying reachable as `localhost`.
  // (Use `host: true` instead if you need to reach the dev server from another device.)
  // strictPort: if 5173 is already taken (a stale server here, or a sibling repo —
  // floaty-schedule / delivery-diary claim the same port), FAIL LOUDLY instead of
  // silently starting on 5174 while the browser stares at the wrong port's white page.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'shared/**/*.{test,spec}.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}', 'shared/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/router.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
