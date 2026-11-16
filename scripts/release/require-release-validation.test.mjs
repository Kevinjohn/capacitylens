import assert from 'node:assert/strict';
import test from 'node:test';
import { combine, judgeRuns, requireValidation } from './require-release-validation.mjs';

const tag = 'v1.2.3';
const sha = 'a'.repeat(40);
const run = (overrides = {}) => ({
  event: 'push',
  head_branch: tag,
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-15T10:00:00Z',
  html_url: 'https://example.test/runs/1',
  ...overrides,
});
const judge = (runs) => judgeRuns(runs, { tag, sha, name: 'Validation' });

test('a successful push run of the tag at its commit passes', () => {
  assert.equal(judge([run()]).state, 'pass');
});

test('a failed or cancelled tag run fails, and a later successful re-run supersedes it', () => {
  assert.equal(judge([run({ conclusion: 'failure' })]).state, 'fail');
  assert.equal(judge([run({ conclusion: 'cancelled' })]).state, 'fail');
  assert.match(judge([run({ conclusion: 'failure' })]).reason, /concluded failure/);
  assert.equal(
    judge([
      run({ conclusion: 'failure' }),
      run({ created_at: '2026-11-15T11:00:00Z', html_url: 'https://example.test/runs/2' }),
    ]).state,
    'pass',
  );
  assert.equal(
    judge([run(), run({ conclusion: 'failure', created_at: '2026-11-15T11:00:00Z' })]).state,
    'fail',
  );
});

test('runs for another event, ref or commit do not count, so publication waits', () => {
  for (const other of [
    run({ event: 'workflow_dispatch' }),
    run({ head_branch: 'main' }),
    run({ head_branch: 'v1.2.4' }),
    run({ head_sha: 'b'.repeat(40) }),
  ])
    assert.equal(judge([other]).state, 'wait');
  assert.equal(judge([run({ status: 'in_progress', conclusion: null })]).state, 'wait');
});

test('any failing workflow fails the release; otherwise any waiting workflow waits', () => {
  assert.equal(combine([{ state: 'pass' }, { state: 'fail' }, { state: 'wait' }]), 'fail');
  assert.equal(combine([{ state: 'pass' }, { state: 'wait' }]), 'wait');
  assert.equal(combine([{ state: 'pass' }, { state: 'pass' }]), 'pass');
});

function clock() {
  let time = 0;
  return { now: () => time, wait: async (ms) => void (time += ms) };
}

test('polling waits for in-progress validation and passes once every workflow succeeds', async () => {
  const { now, wait } = clock();
  let reads = 0;
  const readRuns = () => {
    reads += 1;
    return [run(reads <= 2 ? { status: 'in_progress', conclusion: null } : {})];
  };
  const state = await requireValidation({
    tag,
    sha,
    readRuns,
    deadlineMs: 60_000,
    intervalMs: 10_000,
    now,
    wait,
    log: () => {},
  });
  assert.equal(state, 'pass');
  assert.ok(reads > 2);
});

test('a workflow that never completes fails at the deadline instead of publishing', async () => {
  const { now, wait } = clock();
  const lines = [];
  const state = await requireValidation({
    tag,
    sha,
    readRuns: () => [],
    deadlineMs: 30_000,
    intervalMs: 10_000,
    now,
    wait,
    log: (line) => lines.push(line),
  });
  assert.equal(state, 'fail');
  assert.match(lines.at(-1), /was not validated within/);
});

test('a failed workflow stops polling at once', async () => {
  const { now, wait } = clock();
  let waited = 0;
  const state = await requireValidation({
    tag,
    sha,
    readRuns: (file) => [run(file === 'docker.yml' ? { conclusion: 'failure' } : {})],
    deadlineMs: 60_000,
    now,
    wait: async (ms) => {
      waited += 1;
      await wait(ms);
    },
    log: () => {},
  });
  assert.equal(state, 'fail');
  assert.equal(waited, 0);
});
