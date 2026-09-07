import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

// Standard web types preserve the existing Headers contract and UTF-8/UUID capabilities.
// Their ambient declarations must not grant shared production access to a browser or Node runtime.
const sharedRuntimeGlobals = new Set([...Object.keys(globals.es2023), "console", "crypto", "TextEncoder"]);
const forbiddenSharedGlobals = [
  ...Object.keys({ ...globals.browser, ...globals.node }).filter((name) => !sharedRuntimeGlobals.has(name)),
  // Passing or destructuring the entire global object would bypass named capability restrictions.
  "globalThis",
];

// `isNotNull` is the SQL term in server/src/schema/introspection.ts, not a negated boolean.
const negatedBooleanName = "^(hasNo|not[A-Z]|isNot(?!Null))";

const sharedTestFiles = [
  "shared/src/**/*.{test,spec}.{ts,tsx,mts,cts}",
  "shared/src/**/__tests__/**/*.{ts,tsx,mts,cts}",
];

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
    "scripts/docs-lightbox.js",
    "scripts/docs-standalone.mjs",
  ]),

  // Authored JavaScript shares a baseline, but runtime globals belong to its execution environment.
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ignores: ["public/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/**/*.{js,jsx,mjs,cjs}"],
    ignores: ["public/offline-worker.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["public/offline-worker.js"],
    languageOptions: { globals: globals.serviceworker },
  },

  {
    files: ["**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },

  // Baseline for every TS file in every package (web, shared, server).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
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
    files: ["server/**/*.ts", ...sharedTestFiles, "shared/vitest.config.ts"],
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
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      complexity: ["error", { max: 12 }],
      "max-depth": ["error", 3],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },

  // These paths belong to their package's TypeScript project, including operational server scripts.
  // Root configuration files and JavaScript tooling retain the untyped baseline above.
  {
    files: ["server/src/**/*.ts", "server/scripts/**/*.ts", "shared/src/**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      complexity: ["error", { max: 12 }],
      "max-depth": ["error", 3],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },

  {
    files: ["shared/src/**/*.{ts,tsx,mts,cts}"],
    ignores: sharedTestFiles,
    rules: {
      "no-restricted-globals": ["error", { globals: forbiddenSharedGlobals, checkGlobalObject: true }],
      "no-restricted-imports": ["error", { paths: builtinModules, patterns: ["node:*"] }],
    },
  },

  // End-to-end scenarios share the structural limits even though their Playwright project is
  // separate from the typed app/server lint projects. Tests are not exempt from the baseline.
  {
    files: ["e2e/**/*.{ts,tsx,mts,cts}"],
    rules: {
      complexity: ["error", { max: 12 }],
      "max-depth": ["error", 3],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },

  // The reviewed no-unnecessary-type-assertion probe covered authored production code, not tests.
  {
    files: ["src/**/*.{ts,tsx}", "server/src/**/*.ts", "server/scripts/**/*.ts", "shared/src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["**/*.{test,spec}.{ts,tsx,mts,cts}", "**/__tests__/**/*.{ts,tsx,mts,cts}"],
    rules: { "@typescript-eslint/no-unnecessary-type-assertion": "error" },
  },

  // The mechanical part of docs-src/reference/conventions.md: identifier casing, no negated
  // boolean names, and at most three positional parameters. Properties, methods and imports are
  // unformatted because many mirror wire fields, SQL columns and library names. Existing
  // violations are baselined in eslint-suppressions.json (see the page for how to prune it).
  {
    files: ["src/**/*.{ts,tsx}", "server/src/**/*.ts", "server/scripts/**/*.ts", "shared/src/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "max-params": ["error", 3],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        // An identifier is checked against its first matching selector only, so the
        // negated-name regex is repeated on every selector that names a value.
        {
          selector: "variable",
          modifiers: ["const"],
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          custom: { regex: negatedBooleanName, match: false },
        },
        {
          selector: "variable",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          custom: { regex: negatedBooleanName, match: false },
        },
        {
          selector: "parameter",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
          custom: { regex: negatedBooleanName, match: false },
        },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase", "UPPER_CASE"] },
        {
          selector: ["objectLiteralProperty", "typeProperty", "classProperty", "objectLiteralMethod", "typeMethod"],
          format: null,
        },
        { selector: "import", format: null },
      ],
    },
  },

  // Colocated shared tests use Node; production resolves through the pure package project.
  {
    files: sharedTestFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./shared/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Source-owned shadcn primitives are checked in and maintained here. They
  // legitimately co-export non-component values (variant maps, etc.), which
  // trips the Fast-Refresh rule; turn it off for these primitives only.
  {
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
