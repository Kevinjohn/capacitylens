import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedPhrases, parseRejectedTerms, rejectedTerms } from './terminology.mjs';

test('the rejected synonyms are read from the dictionary table', () => {
  assert.deepEqual(rejectedTerms[0], {
    rejected: 'tenant',
    preferred: 'company',
    entry: 'The tenant',
  });
  assert.ok(rejectedTerms.some(({ rejected }) => rejected === 'modal'));
});

test('a dictionary without its markers or with a short row is refused', () => {
  assert.throws(() => parseRejectedTerms('| Rejected | Say | Entry |'), /markers/);
  const table = (row) =>
    `<!-- terminology:enforced:start -->\n| Rejected | Say | Entry |\n| --- | --- | --- |\n${row}\n<!-- terminology:enforced:end -->`;
  assert.throws(() => parseRejectedTerms(table('| tenant | company |')), /malformed row/);
  assert.deepEqual(parseRejectedTerms(table('| tenant | company | The tenant |')), [
    { rejected: 'tenant', preferred: 'company', entry: 'The tenant' },
  ]);
});

test('every rejected and allowed phrase is lowercase and single-spaced', () => {
  for (const { rejected } of rejectedTerms) assert.match(rejected, /^[a-z]+(?: [a-z]+)*$/);
  for (const { phrase } of allowedPhrases) assert.match(phrase, /^[a-z]+(?: [a-z]+)*$/);
});
