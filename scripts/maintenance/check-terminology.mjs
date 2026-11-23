// Fails on a rejected synonym from code_convention_terminology.md, in file names and in the text of
// source, tests, scripts, documentation, user stories and UI messages. The list and its exemptions
// are data in tooling/terminology.mjs.
//
//   node scripts/maintenance/check-terminology.mjs            the whole tracked tree
//   node scripts/maintenance/check-terminology.mjs <path>...  only those paths
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  allowedInFiles,
  allowedPaths,
  allowedPhrases,
  rejectedTerms,
} from '../../tooling/terminology.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Text is read under these directories and in root Markdown; a file's own path is always checked.
const textRoots = /^(?:apps|packages|scripts|tooling|e2e|docs-src|user-stories)\//;
const textFile = /\.(?:[cm]?[jt]sx?|json|md|mdx)$/;
const wordPattern = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g;
// Words of one phrase may be separated by spaces, underscores and hyphens, or by a line break.
const phraseGap = /^[\s_-]*$/;

const stem = (word) => {
  const lower = word.toLowerCase();
  return lower.length > 3 && lower.endsWith('s') ? lower.slice(0, -1) : lower;
};
const phraseWords = (phrase) => phrase.split(' ').map(stem);

const rejected = rejectedTerms.map((term) => ({ ...term, words: phraseWords(term.rejected) }));
const allowed = allowedPhrases.map(({ phrase }) => phraseWords(phrase));

const underPath = (path, entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry);

/** Report whether the check reads this path's text, and whether it checks its name. */
export function isExempt(path) {
  return allowedPaths.some(({ path: entry }) => underPath(path, entry));
}

function readsText(path) {
  return textFile.test(path) && (textRoots.test(path) || !path.includes('/'));
}

/** Split text into stemmed words with their offsets and the gap that precedes each one. */
function wordsOf(text) {
  const words = [];
  let previousEnd = 0;
  for (const match of text.matchAll(wordPattern)) {
    words.push({
      stem: stem(match[0]),
      start: match.index,
      gap: text.slice(previousEnd, match.index),
    });
    previousEnd = match.index + match[0].length;
  }
  return words;
}

function phraseAt(words, index, phrase) {
  return phrase.every((word, offset) => {
    const candidate = words[index + offset];
    if (!candidate || candidate.stem !== word) return false;
    return offset === 0 || (phraseGap.test(candidate.gap) && !/\n\s*\n/.test(candidate.gap));
  });
}

/** List the rejected synonyms in a string: `{ rejected, preferred, offset }` per match. */
export function findInText(text, skipped = []) {
  const words = wordsOf(text);
  const ignored = new Set();
  words.forEach((_, index) =>
    allowed.forEach((phrase) => {
      if (phraseAt(words, index, phrase))
        phrase.forEach((__, offset) => ignored.add(index + offset));
    }),
  );
  const found = [];
  words.forEach((word, index) =>
    rejected.forEach((term) => {
      if (skipped.includes(term.rejected) || !phraseAt(words, index, term.words)) return;
      if (term.words.some((__, offset) => ignored.has(index + offset))) return;
      found.push({ rejected: term.rejected, preferred: term.preferred, offset: word.start });
    }),
  );
  return found;
}

/**
 * Check paths and report one message per rejected synonym. `read` returns a file's text, or
 * `undefined` for a file that is gone or not text.
 */
export function findViolations(paths, read = readFile) {
  const messages = [];
  for (const path of paths) {
    if (isExempt(path)) continue;
    const skipped = allowedInFiles
      .filter((entry) => entry.path === path)
      .flatMap((entry) => entry.terms);
    for (const hit of findInText(path.replaceAll('/', ' '), skipped))
      messages.push(
        `${path}: the file name says "${hit.rejected}"; say "${hit.preferred}" (code_convention_terminology.md)`,
      );
    if (!readsText(path)) continue;
    const text = read(path);
    if (text === undefined) continue;
    for (const hit of findInText(text, skipped)) {
      const line = text.slice(0, hit.offset).split('\n').length;
      messages.push(
        `${path}:${line}: "${hit.rejected}"; say "${hit.preferred}" (code_convention_terminology.md)`,
      );
    }
  }
  return messages;
}

function readFile(path) {
  const url = new URL(path, pathToFileURL(root));
  return existsSync(url) ? readFileSync(url, 'utf8') : undefined;
}

function main() {
  const given = process.argv.slice(2);
  const paths = given.length
    ? given
    : execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\n')
        .filter(Boolean);
  const messages = findViolations(
    paths.filter((path) => existsSync(new URL(path, pathToFileURL(root)))),
  );
  for (const message of messages) console.error(message);
  if (messages.length) {
    console.error(
      `${messages.length} rejected synonym(s). The ruling is in code_convention_terminology.md.`,
    );
    process.exitCode = 1;
  } else console.log(`terminology: ${paths.length} path(s) checked, no rejected synonyms`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
