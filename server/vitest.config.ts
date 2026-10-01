import { fileURLToPath } from "node:url";

// Plain config object (not wrapped in defineConfig) so this package doesn't need
// `vite` installed just to resolve vitest/config's helper. Server tests run in a
// Node environment — no jsdom, no React setup — deliberately separate from the web
// app's vite.config.ts so vitest doesn't inherit that root config from this dir.
export default {
  // app.syncOrdering.integration.test.ts loads the browser sync adapter, whose imports use the app's
  // `@/` alias, so the server tests resolve it the same way vite.config.ts does.
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
};
