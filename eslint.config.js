import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results', '**/node_modules', '.claude/worktrees/**']),

  // Baseline for every TS file in every package (web, shared, server).
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // The web app is the only React package — React/Fast-Refresh rules and browser
  // globals apply here, not to the DOM-free shared/ and server/ packages.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Node packages: Node globals (process, etc.).
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    // Type-aware linting for the app source only (it's the code in the web tsconfig
    // project; e2e/config/other-package files aren't, and don't need these rules).
    files: ['src/**/*.{ts,tsx}'],
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
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Generated shadcn/ui primitives live here. They legitimately co-export
  // non-component values (variant maps, etc.), which trips the Fast-Refresh
  // rule; turn it off for generated files only, not hand-written components.
  {
    files: ['src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
