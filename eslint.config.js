import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import { readFileSync } from "node:fs";

const gitIgnoredPaths = readFileSync(new URL(".gitignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
  .map((line) => line.replace(/^\//, "").replace(/\/$/, "/**"));

export default defineConfig([
  globalIgnores([
    ...gitIgnoredPaths,
    "**/dist/**",
    "**/coverage/**",
    "playwright-report",
    "test-results",
    "**/node_modules",
    // Paraglide-generated i18n output (P1.5.1) — machine-generated, never hand-edited or linted.
    "src/paraglide",
    // Stryker mutation-testing sandbox + report (`pnpm run mutation`) — copies of the whole repo;
    // linting them double-parses every file and confuses the typed parser's tsconfig-root lookup.
    ".stryker-tmp",
    "reports",
    // Documentation: docs/ is the generated build, docs-src/ is hand-maintained
    // prose (plus its VitePress config) — linters keep their hands off both.
    "docs",
    "docs-src",
  ]),

  // Gate and public runtime scripts are production code too. Keep them on the recommended JS
  // rules with Node globals; previously the .mjs files matched no config at all.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/auth-error-init.js", "public/theme-init.js", "scripts/docs-lightbox.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["public/offline-worker.js"],
    languageOptions: { globals: globals.serviceworker },
  },

  // Baseline for every TS file in every package (web, shared, server).
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // The web app is the only React package — React/Fast-Refresh rules and browser
  // globals apply here, not to the DOM-free shared/ and server/ packages.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Node packages: Node globals (process, etc.).
  {
    files: ["server/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    // Type-aware linting for the app source only (it's the code in the web tsconfig
    // project; e2e/config/other-package files aren't, and don't need these rules).
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The reviewer's concrete gap: the `void promise` discipline (persist.ts,
      // main.tsx) was unenforced under plain `recommended`. These catch an
      // un-awaited / un-voided promise instead of letting it float silently.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // These paths belong to their package's TypeScript project, including operational server scripts.
  // Root configuration files and JavaScript tooling retain the untyped baseline above.
  {
    files: ["server/src/**/*.ts", "server/scripts/**/*.ts", "shared/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // Generated shadcn/ui primitives live here. They legitimately co-export
  // non-component values (variant maps, etc.), which trips the Fast-Refresh
  // rule; turn it off for generated files only, not hand-written components.
  {
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
