import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowedPhrases,
  rejectedTerms,
  renderRejectionTable,
  renderReviewList,
  reviewOnlyTerms,
} from './terminology.mjs';

const dictionary = readFileSync(
  new URL('../code_convention_terminology.md', import.meta.url),
  'utf8',
);

function between(name) {
  const [, rest] = dictionary.split(`<!-- terminology:${name}:start -->`);
  assert.ok(rest, `the dictionary lacks the ${name} start marker`);
  const [block] = rest.split(`<!-- terminology:${name}:end -->`);
  return block.trim();
}
// Prettier aligns table columns, so compare cells and not spacing.
const cells = (table) =>
  table.split('\n').map((row) => row.split('|').map((cell) => cell.trim().replace(/^-+$/, '---')));

test('the enforced table in the dictionary is the generated one', () => {
  assert.deepEqual(cells(between('enforced')), cells(renderRejectionTable()));
});

test('the review-only list in the dictionary is the generated one', () => {
  assert.equal(between('review'), renderReviewList());
});

test('every rejected phrase is also written in the dictionary outside the generated blocks', () => {
  const prose = dictionary
    .replace(/<!-- terminology:enforced:start -->[\s\S]*<!-- terminology:enforced:end -->/, '')
    .toLowerCase();
  for (const { rejected } of rejectedTerms)
    assert.ok(
      prose.includes(rejected) || prose.includes(rejected.replaceAll(' ', '')),
      `"${rejected}" is rejected by the check but the dictionary never says so`,
    );
});

test('no rejected word is also a review-only word, and every entry is lowercase and single-spaced', () => {
  const reviewWords = reviewOnlyTerms.flatMap(({ word }) => word.split(/,\s*/));
  for (const { rejected } of rejectedTerms) {
    assert.match(rejected, /^[a-z]+(?: [a-z]+)*$/);
    assert.ok(!reviewWords.includes(rejected), `${rejected} is both enforced and review-only`);
  }
  for (const { phrase } of allowedPhrases) assert.match(phrase, /^[a-z]+(?: [a-z]+)*$/);
});
