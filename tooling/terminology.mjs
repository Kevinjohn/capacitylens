// The enforceable part of code_convention_terminology.md: one source for the rejected synonyms and
// for the places that may keep them. scripts/maintenance/check-terminology.mjs reads it, and the
// Enforced rejections table in the dictionary is generated from `rejectedTerms`, so the two cannot
// disagree (tooling/terminology.test.mjs compares them).
//
// A rejected entry is a word or a phrase. It matches whole words, ignoring case, inside
// identifiers, file names, comments and prose: `routeGuards`, `route_guards.ts` and "Route guard"
// all match `route guard`. A trailing "s" is ignored, so the plural needs no entry.
//
// Only a word with no legitimate second meaning belongs here. A word that also has an ordinary,
// framework or package meaning stays a review rule (`reviewOnlyTerms`).

/** Rejected synonym or phrase, the ruling that replaces it, and the dictionary entry that rules it. */
export const rejectedTerms = [
  { rejected: 'tenant', preferred: 'company', entry: 'The tenant' },
  { rejected: 'workspace id', preferred: 'company id', entry: 'The tenant' },
  { rejected: 'principal', preferred: 'user', entry: 'A sign-in identity' },
  { rejected: 'catalog', preferred: 'catalogue', entry: 'Planning reference data' },
  { rejected: 'utilization', preferred: 'utilisation', entry: 'Booked share of capacity' },
  { rejected: 'repeatable', preferred: 'repeat', entry: 'What is scheduled' },
  { rejected: 'unarchive', preferred: 'restore', entry: 'Undo an archive' },
  { rejected: 'reinstate', preferred: 'restore membership', entry: 'Member status' },
  { rejected: 'reactivate', preferred: 'restore membership', entry: 'Member status' },
  { rejected: 'unsuspend', preferred: 'restore membership', entry: 'Member status' },
  { rejected: 'anonymize', preferred: 'anonymise', entry: 'Remove personal data' },
  { rejected: 'anonymization', preferred: 'anonymisation', entry: 'Remove personal data' },
  { rejected: 'interchange', preferred: 'export', entry: 'The company file' },
  { rejected: 'company document', preferred: 'company export', entry: 'The company file' },
  { rejected: 'signup', preferred: 'sign up', entry: 'Joining' },
  { rejected: 'onboarding', preferred: 'getting started', entry: 'First-run checklist' },
  { rejected: 'sample data', preferred: 'example data', entry: 'Sample data' },
  { rejected: 'login screen', preferred: 'sign-in screen', entry: 'Sessions' },
  { rejected: 'login form', preferred: 'sign-in form', entry: 'Sessions' },
  { rejected: 'route guard', preferred: 'route middleware', entry: 'route middleware' },
  { rejected: 'entity policy', preferred: 'entity rules', entry: 'rules' },
  { rejected: 'planning authority', preferred: 'authorization', entry: 'authorization' },
  { rejected: 'company authority', preferred: 'authorization', entry: 'authorization' },
  { rejected: 'identity authority', preferred: 'authorization', entry: 'authorization' },
  { rejected: 'planning capabilities', preferred: 'access grant', entry: 'access grant' },
  { rejected: 'planning command', preferred: 'intent', entry: 'intent' },
  { rejected: 'account command', preferred: 'account operation', entry: 'operation' },
  { rejected: 'authenticated boundary', preferred: 'gate', entry: 'gate' },
  { rejected: 'login boundary', preferred: 'gate', entry: 'gate' },
  { rejected: 'loading boundary', preferred: 'gate', entry: 'gate' },
  { rejected: 'test support', preferred: 'test kit', entry: 'test kit' },
  { rejected: 'modal', preferred: 'dialog', entry: 'dialog' },
];

/**
 * Words the dictionary rules on but the check cannot enforce, because each has a legitimate second
 * meaning. Reviewers apply them. The dictionary's Review-only words section lists the same words.
 */
export const reviewOnlyTerms = [
  { word: 'guard', why: 'type guard, authentication guard' },
  { word: 'policy', why: 'Content-Security-Policy, passwordPolicy, CORS policy' },
  { word: 'exception', why: 'a special case in prose' },
  { word: 'organisation', why: 'the clients a company works for, and the autocomplete token' },
  { word: 'assignee, assignment', why: 'copyright assignment, assignment expressions, GitHub CLI' },
  { word: 'leave, absence', why: 'the verb and the ordinary noun' },
  { word: 'recurring', why: 'a recurring workflow' },
  { word: 'snapshot', why: 'Vitest snapshots, React getSnapshot, planning snapshots' },
  { word: 'login, logout, register', why: 'Account Kit calls, HTTP Basic, library APIs' },
  { word: 'view as, member view', why: 'the UI words "View as member" contain them' },
  { word: 'administrator', why: 'a hosting administrator is the operator' },
  { word: 'authority, capabilities', why: 'security prose and browser capabilities' },
  { word: 'fake, double, support', why: 'fake timers, number types, ordinary support' },
  { word: 'purge, transfer, rejection', why: 'cache purge, ownership transfer, promise rejection' },
  { word: 'workspace', why: 'pnpm workspaces' },
];

/** Files and directories the check does not read, and why. A path ending in "/" is a directory. */
export const allowedPaths = [
  { path: 'code_convention_terminology.md', reason: 'the dictionary names the rejected words' },
  { path: 'tooling/terminology.mjs', reason: 'the list of rejected words' },
  { path: 'tooling/terminology.test.mjs', reason: 'tests that quote rejected words' },
  {
    path: 'scripts/maintenance/check-terminology.test.mjs',
    reason: 'tests that quote rejected words',
  },
  { path: 'apps/frontend/src/components/ui/', reason: 'vendored shadcn components' },
  { path: 'apps/backend/.adonisjs/', reason: 'generated AdonisJS output' },
  { path: 'docs-src/public/', reason: 'published review artefacts and assets' },
  { path: 'graphify-out/', reason: 'hand-built graph snapshots' },
  { path: 'pnpm-lock.yaml', reason: 'lockfile' },
  { path: 'LICENSE', reason: 'licence text' },
];

/** Rejected words one file may keep, because it quotes names another project owns. */
export const allowedInFiles = [
  {
    path: 'docs-src/reference/adonisjs-conventions.md',
    terms: ['tenant'],
    reason: 'the vocabulary page names the rejected word to reject it',
  },
  {
    path: 'docs-src/reference/adonisjs-cookbook.md',
    terms: ['signup'],
    reason: 'framework-neutral example code quotes the AdonisJS starter names',
  },
  {
    path: 'docs-src/reference/adonisjs-checklist.md',
    terms: ['signup'],
    reason: 'framework-neutral rule examples quote the AdonisJS starter names',
  },
];

/** Phrases that contain a rejected word but name something else. Matched like rejected terms. */
export const allowedPhrases = [
  { phrase: 'aria modal', reason: 'the WAI-ARIA attribute `aria-modal`' },
  { phrase: 'modal dialog', reason: 'the WAI-ARIA term for a dialog that traps focus' },
  {
    phrase: 'non modal',
    reason: 'the WAI-ARIA and Radix term for a dialog that does not trap focus',
  },
  {
    phrase: 'account command id',
    reason: '`commandId`, the paired handle of an account operation',
  },
  { phrase: 'account command palette', reason: 'the command palette entry for the Account page' },
];

/** Render the Markdown list of review-only words the dictionary carries between its markers. */
export function renderReviewList() {
  return reviewOnlyTerms.map(({ word, why }) => `- ${word}: ${why}`).join('\n');
}

/** Render the Markdown table the dictionary carries between its terminology markers. */
export function renderRejectionTable() {
  const rows = rejectedTerms.map(
    ({ rejected, preferred, entry }) => `| ${rejected} | ${preferred} | ${entry} |`,
  );
  return ['| Rejected | Say | Entry |', '| --- | --- | --- |', ...rows].join('\n');
}
