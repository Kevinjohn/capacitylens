/** Generated output, reports and local worktrees every sibling excludes consistently. */
export const FAMILY_GLOBAL_IGNORES = [
  'dist',
  '**/coverage/**',
  'playwright-report',
  'test-results',
  '**/node_modules',
  '.claude/worktrees/**',
  '.stryker-tmp',
  'reports',
]

/** Promise safety is a family invariant on every typed data path. */
export const PROMISE_SAFETY_RULES = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
}
