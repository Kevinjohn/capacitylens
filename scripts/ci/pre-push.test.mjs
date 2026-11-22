import assert from 'node:assert/strict';
import test from 'node:test';
import { deletesOnly, needsFullCheck, pushChecks } from './pre-push.mjs';

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
  assert.equal(
    deletesOnly(`refs/heads/feature ${'0'.repeat(8)}${'c'.repeat(32)} refs/heads/feature ${sha}\n`),
    false,
  );
});

test('a push mixing a deletion and an update keeps the checks', () => {
  assert.equal(deletesOnly(deletion + update), false);
  assert.equal(deletesOnly(update + deletion), false);
});

test('a push with nothing to update keeps the checks', () => {
  assert.equal(deletesOnly(''), false);
  assert.equal(deletesOnly('\n'), false);
});

const head = 'd'.repeat(40);
const branchAtHead = `refs/heads/feature ${head} refs/heads/feature ${zero}\n`;

test('a push that only deletes remote branches selects no checks', () => {
  assert.equal(pushChecks(deletion, head), 'none');
});

test('pushing the checked-out commit to a branch checks only what the branch changed', () => {
  assert.equal(pushChecks(branchAtHead, head), 'changed');
  assert.equal(pushChecks(deletion + branchAtHead, head), 'changed');
});

test('a commit that is not checked out keeps the whole check', () => {
  assert.equal(pushChecks(update, head), 'full');
  assert.equal(pushChecks(branchAtHead + update, head), 'full');
});

test('a tag keeps the whole check, even at the checked-out commit', () => {
  assert.equal(pushChecks(`refs/tags/v1.0.0 ${head} refs/tags/v1.0.0 ${zero}\n`, head), 'full');
  assert.equal(
    pushChecks(`${branchAtHead}refs/tags/v1.0.0 ${head} refs/tags/v1.0.0 ${zero}\n`, head),
    'full',
  );
});

test('a push with nothing to update keeps the whole check', () => {
  assert.equal(pushChecks('', head), 'full');
});

test('a changed-files check that passed or failed is final; one that could not run falls back to the whole check', () => {
  assert.equal(needsFullCheck(0), false);
  assert.equal(needsFullCheck(1), false);
  assert.equal(needsFullCheck(2), true);
  assert.equal(needsFullCheck(null), true);
});
