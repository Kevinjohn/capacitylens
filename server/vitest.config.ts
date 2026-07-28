// Plain config object (not wrapped in defineConfig) so this package doesn't need
// `vite` installed just to resolve vitest/config's helper. Server tests run in a
// Node environment — no jsdom, no React setup — deliberately separate from the web
// app's vite.config.ts so vitest doesn't inherit that root config from this dir.
export default {
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}
