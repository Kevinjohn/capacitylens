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

const sharedTestFiles = [
  "packages/shared/src/**/*.{test,spec}.{ts,tsx,mts,cts}",
  "packages/shared/src/**/__tests__/**/*.{ts,tsx,mts,cts}",
];
// `@/` maps only to src/, so it cannot name a repository file outside it. These files read one,
// and each may import only the specifiers listed against it.
const parentImportAllowances = {
  "apps/frontend/src/data/buildInfo.ts": ["../../../../package.json"],
  "apps/frontend/src/build/staticSpaRouteDocuments.test.ts": ["../../vite.config"],
  "apps/frontend/src/bundleBudgetGate.test.ts": ["../../../scripts/bundleBudget.mjs"],
  "apps/frontend/src/csp.test.ts": [
    "../../../nginx.conf?raw",
    "../../../nginx.client.conf.template?raw",
    "../../../nginx-security-headers.conf?raw",
    "../../../scripts/render-client-nginx.mjs",
  ],
  "apps/frontend/src/playwrightServerScope.test.ts": [
    "../../../scripts/playwrightServerScope",
    "../../../scripts/playwrightRunMode.mjs",
  ],
  "apps/frontend/src/pnpmSpawn.test.ts": ["../../../scripts/pnpmSpawn.mjs"],
  "apps/frontend/src/router.test.tsx": ["../../../scripts/staticSpaRoutes.mjs"],
  "apps/frontend/src/serve-dist.test.ts": ["../../../scripts/serve-dist.mjs"],
  "apps/frontend/src/test/generateDocumentationComponentId.test.ts": [
    "../../../../docs-src/.vitepress/generateDocumentationComponentId.mts",
    "../../../../docs-src/.vitepress/config.mts",
  ],
};

const inlineTypeImportGuard = {
  selector: "ImportSpecifier[importKind='type']",
  message: "Use a separate `import type` declaration for type-only imports.",
};

const recordGuard = {
  selector: "FunctionDeclaration[id.name=/^is(Unknown)?Record$/], VariableDeclarator[id.name=/^is(Unknown)?Record$/]",
  message: "Import isRecord from @capacitylens/shared/lib/isRecord instead of defining another copy.",
};

/**
 * Rejects parent-relative app module specifiers (`..` or `../…`) in static imports, `import()`,
 * `import("…")` types and Vitest module calls, except the exact specifiers listed. `/` is written
 * as `\x2F` because selector regexes cannot contain a slash.
 */
function parentImportRules(allowedSpecifiers) {
  const allowed = allowedSpecifiers.map((specifier) => specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const lookahead = allowed.length ? `(?!(?:${allowed.join("|")})$)` : "";
  const regex = `^${lookahead}\\.\\.(?:/|$)`.replaceAll("/", "\\x2F");
  const message = "Import from another folder with `@/…`; use `./` only within the importing file's folder.";
  const vitestModuleCall =
    "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock|unmock|doUnmock|importActual|importMock)$/]";
  return {
    "no-restricted-imports": ["error", { patterns: [{ regex, message }] }],
    "no-restricted-syntax": [
      "error",
      recordGuard,
      inlineTypeImportGuard,
      { selector: `ImportExpression > Literal.source[value=/${regex}/]`, message },
      { selector: `TSImportType[source.value=/${regex}/]`, message },
      { selector: `${vitestModuleCall} > Literal.arguments:first-child[value=/${regex}/]`, message },
    ],
  };
}

const gitIgnoredPaths = readFileSync(new URL(".gitignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
  .map((line) => line.replace(/^\//, "").replace(/\/$/, "/**"));

/** Defines repository lint policies with runtime and TypeScript boundaries scoped to their owning packages. */
export default defineConfig([
  globalIgnores([
    ...gitIgnoredPaths,
    "**/dist/**",
    "**/coverage/**",
    "playwright-report",
    "test-results",
    "**/node_modules",
    // Paraglide generates this runtime from committed sources, so linting skips it.
    "apps/frontend/src/paraglide",
    // Stryker copies the repository into generated sandboxes; linting those copies duplicates work and confuses project lookup.
    ".stryker-tmp",
    "reports",
    // Linters skip both documentation trees: docs/ is generated, and docs-src/ contains
    // prose and the VitePress config.
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
    ignores: ["apps/frontend/public/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/frontend/public/**/*.{js,jsx,mjs,cjs}"],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ["**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },

  // Baseline for every TS file in every package (web, shared, server).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports", disallowTypeAnnotations: false },
      ],
      "no-restricted-syntax": ["error", inlineTypeImportGuard],
    },
  },

  // React/Fast-Refresh rules and browser globals apply only to the web app; shared/ and
  // server/ stay DOM-free.
  {
    files: ["apps/frontend/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Node packages: Node globals (process, etc.).
  {
    files: ["apps/backend/**/*.ts", ...sharedTestFiles, "packages/shared/vitest.config.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    // Type-aware linting for the app source only (it's the code in the web tsconfig
    // project; e2e/config/other-package files aren't, and don't need these rules).
    files: ["apps/frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Require promises to be awaited, handled or explicitly discarded, and reject promises used where synchronous values are expected.
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
    },
  },

  // These paths belong to their package's TypeScript project, including operational server scripts.
  // Root configuration files and JavaScript tooling retain the untyped baseline above.
  {
    files: ["packages/shared/src/**/*.{ts,tsx,mts,cts}"],
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
    },
  },

  {
    files: ["packages/shared/src/**/*.{ts,tsx,mts,cts}"],
    ignores: sharedTestFiles,
    rules: {
      "no-restricted-globals": ["error", { globals: forbiddenSharedGlobals, checkGlobalObject: true }],
      "no-restricted-imports": ["error", { paths: builtinModules, patterns: ["node:*"] }],
    },
  },

  // Apply this rule to authored production code.
  {
    files: ["apps/frontend/src/**/*.{ts,tsx}", "packages/shared/src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["**/*.{test,spec}.{ts,tsx,mts,cts}", "**/__tests__/**/*.{ts,tsx,mts,cts}"],
    rules: { "@typescript-eslint/no-unnecessary-type-assertion": "error" },
  },

  // One record guard for the whole tree: shared/src/lib/isRecord.ts.
  {
    files: ["apps/frontend/src/**/*.{ts,tsx}", "packages/shared/src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["packages/shared/src/lib/isRecord.ts"],
    rules: {
      "no-restricted-syntax": ["error", recordGuard, inlineTypeImportGuard],
    },
  },

  // App imports that leave the importing file's folder use `@/…`; `./` stays within a folder.
  // These blocks restate the record guard because a later no-restricted-syntax replaces it.
  { files: ["apps/frontend/src/**/*.{ts,tsx}"], rules: parentImportRules([]) },
  ...Object.entries(parentImportAllowances).map(([file, allowed]) => ({
    files: [file],
    rules: parentImportRules(allowed),
  })),

  // Colocated shared tests use Node; production resolves through the pure package project.
  {
    files: sharedTestFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./packages/shared/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Source-owned shadcn primitives are checked in and maintained here. They
  // legitimately co-export non-component values (variant maps, etc.), which
  // trips the Fast-Refresh rule; turn it off for these primitives only.
  {
    files: ["apps/frontend/src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
