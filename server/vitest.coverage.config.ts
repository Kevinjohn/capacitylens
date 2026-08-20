// Plain config object (not wrapped in defineConfig) so this package doesn't need
// `vite` installed just to resolve vitest/config's helper. Server tests run in a
// Node environment — no jsdom, no React setup — deliberately separate from the web
// app's vite.config.ts so vitest doesn't inherit that root config from this dir.
export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Keep these exclusions in sync with `isolatedSuites` in scripts/run-unit-shard.mjs.
    exclude: [
      "src/accounts/conformance/accountFlows.conformance.test.ts",
      "src/credentialOnboardingDurability.test.ts",
      "src/rehearseMigrations.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/fixtures/**"],
      // Baseline measured 2026-08-18: 89.69% statements, 82.93% branches, 92.63% functions,
      // 91.44% lines. Thresholds sit just below so the gate catches regressions without
      // flaking on small refactors; ratchet them upward as coverage improves.
      thresholds: { statements: 87, branches: 80, functions: 90, lines: 89 },
    },
  },
};
