import { configApp } from '@adonisjs/eslint-config'

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
    files: ['app/services/audit.ts', 'app/services/batch/**/*.ts', 'app/services/lifecycle.ts'],
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
  }
)
