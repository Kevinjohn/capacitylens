import { readFileSync } from 'node:fs';

// The enforceable part of code_convention_terminology.md. Its Enforced rejections table is the one
// list of rejected synonyms; this module reads it, and holds the places that may keep them.
// scripts/maintenance/check-terminology.mjs applies both.
//
// A rejected entry is a word or a phrase. It matches whole words, ignoring case, inside
// identifiers, file names, comments and prose: `routeGuards`, `route_guards.ts` and "Route guard"
// all match `route guard`. A trailing "s" is ignored, so the plural needs no entry.

/**
 * Read the rejected synonyms, the rulings that replace them and the entries that rule them from the
 * dictionary's table between its terminology markers.
 *
 * @throws When the markers are missing or a row does not have three cells.
 */
export function parseRejectedTerms(dictionary) {
  const [, rest] = dictionary.split('<!-- terminology:enforced:start -->');
  const table = rest?.split('<!-- terminology:enforced:end -->')[0];
  if (rest === undefined || table === rest)
    throw new Error('The dictionary lacks its terminology:enforced markers.');
  return table
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length !== 3 || cells.some((cell) => cell === ''))
        throw new Error(`The enforced table has a malformed row: ${line}`);
      const [rejected, preferred, entry] = cells;
      return { rejected, preferred, entry };
    });
}

/** Rejected synonym or phrase, the ruling that replaces it, and the dictionary entry that rules it. */
export const rejectedTerms = parseRejectedTerms(
  readFileSync(new URL('../code_convention_terminology.md', import.meta.url), 'utf8'),
);

/** Files and directories the check does not read, and why. A path ending in "/" is a directory. */
export const allowedPaths = [
  { path: 'code_convention_terminology.md', reason: 'the dictionary names the rejected words' },
  { path: 'tooling/terminology.mjs', reason: 'comments that quote rejected words' },
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
