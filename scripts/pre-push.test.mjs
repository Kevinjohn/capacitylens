import assert from 'node:assert/strict';
import test from 'node:test';
import { deletesOnly } from './pre-push.mjs';

const zero = '0'.repeat(40);
const sha = 'a'.repeat(40);
const deletion = `(delete) ${zero} refs/heads/old ${sha}\n`;
const update = `refs/heads/feature ${sha} refs/heads/feature ${zero}\n`;

test('a push that only deletes remote branches skips the checks', () => {
  assert.equal(deletesOnly(deletion), true);
  assert.equal(deletesOnly(deletion + deletion.replace('old', 'older')), true);
});

test('a SHA-256 deletion counts as a deletion', () => {
  assert.equal(deletesOnly(`(delete) ${'0'.repeat(64)} refs/heads/old ${'b'.repeat(64)}\n`), true);
});

test('a push that sends commits keeps the checks', () => {
  assert.equal(deletesOnly(update), false);
});

test('a push mixing a deletion and an update keeps the checks', () => {
  assert.equal(deletesOnly(deletion + update), false);
  assert.equal(deletesOnly(update + deletion), false);
});

test('a push with nothing to update keeps the checks', () => {
  assert.equal(deletesOnly(''), false);
  assert.equal(deletesOnly('\n'), false);
});
