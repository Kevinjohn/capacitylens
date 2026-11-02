import { configApp } from '@adonisjs/eslint-config';

export default configApp(
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    files: [
      'app/**/*.ts',
      'commands/**/*.ts',
      'providers/**/*.ts',
      'start/**/*.ts',
      'tests/**/*.ts',
    ],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['database/schema.ts'],
    // Lucid owns this output's format; all semantic lint and type checks still apply.
    rules: { 'prettier/prettier': 'off' },
  },
  {
    files: ['app/services/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='query']:not(:has(ObjectExpression.arguments > Property[key.name='client']))",
          message: 'Service model queries must pass an explicit { client } capability.',
        },
      ],
    },
  },
  {
    files: ['app/services/audit.ts', 'app/services/lifecycle.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@adonisjs/lucid/services/db',
              message: 'Mutating services receive a transaction client as their first argument.',
            },
            {
              name: '#services/state_repository',
              importNames: ['readState'],
              message: 'Transactional services must use readStateWithClient(trx).',
            },
          ],
        },
      ],
    },
  },
  {
    // The type-aware rules the root config applies to the frontend and shared packages. The
    // no-unsafe-* rules stay off here: Lucid query results and HttpContext params are typed any,
    // so they would report the framework rather than this code. no-unnecessary-type-assertion
    // stays off for the same reason: its fixer strips the `as` that narrows those any values. `curly` is enabled explicitly
    // because eslint-config-prettier, which the preset spreads last, turns the preset's own off.
    files: ['app/**/*.ts', 'commands/**/*.ts', 'providers/**/*.ts', 'start/**/*.ts'],
    rules: {
      'curly': ['error', 'multi-line'],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  }
);
