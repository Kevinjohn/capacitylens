import { configApp } from '@adonisjs/eslint-config'

export default configApp(
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    files: ['database/schema.ts'],
    // Lucid owns this output's format; all semantic lint and type checks still apply.
    rules: { 'prettier/prettier': 'off' },
  }
)
