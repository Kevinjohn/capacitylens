import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { readCommit, selectValidation } from './select-validation.mjs';

const main = 'a'.repeat(40);
const branch = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const runUrl = 'https://github.com/Kevinjohn/capacitylens/actions/runs/1';
const merged = { parents: [main, branch], tree, mergedTree: tree, validatedRunUrl: runUrl };

const workflow = (name) =>
  parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));

test('a merge whose tree a manual run already passed skips validation', () => {
  assert.deepEqual(selectValidation(merged), {
    scope: 'skip',
    reason: `the identical tree passed ${runUrl}`,
  });
});

test('a commit that is not a two-parent merge runs validation', () => {
  for (const parents of [[], [main], [main, branch, 'd'.repeat(40)]])
    assert.equal(selectValidation({ ...merged, parents }).scope, 'run', `${parents.length}`);
});

test('a merge into a main that had moved runs validation', () => {
  assert.equal(selectValidation({ ...merged, mergedTree: 'e'.repeat(40) }).scope, 'run');
});

test('a merge with no successful manual run on the branch head runs validation', () => {
  assert.equal(selectValidation({ ...merged, validatedRunUrl: '' }).scope, 'run');
});

test('two trees that could not be read never count as equal', () => {
  assert.equal(selectValidation({ ...merged, tree: '', mergedTree: '' }).scope, 'run');
});

test('the commit is read from git and the manual runs on the merged branch head', () => {
  const calls = [];
  const read = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'rev-list') return `${'f'.repeat(40)} ${main} ${branch}`;
    if (args[0] === 'rev-parse') return tree;
    return runUrl;
  };
  assert.deepEqual(readCommit(read, 'Kevinjohn/capacitylens'), merged);
  assert.ok(calls.includes(`git rev-parse ${branch}^{tree}`));
  const lookup = calls.find((call) => call.startsWith('gh api'));
  assert.match(
    lookup,
    /repos\/Kevinjohn\/capacitylens\/actions\/workflows\/validation\.yml\/runs\?/,
  );
  assert.match(lookup, new RegExp(`head_sha=${branch}&event=workflow_dispatch&status=success`));
});

test('a failed read selects validation instead of failing the selection', () => {
  const failing = (command, args) => {
    if (command === 'gh') throw new Error('rate limited');
    if (args[0] === 'rev-list') return `${'f'.repeat(40)} ${main} ${branch}`;
    return tree;
  };
  assert.equal(selectValidation(readCommit(failing, 'Kevinjohn/capacitylens')).scope, 'run');
  const noGit = () => {
    throw new Error('not a repository');
  };
  assert.equal(selectValidation(readCommit(noGit, 'Kevinjohn/capacitylens')).scope, 'run');
});

test('only a main push selects, and a failed selection still runs every job', () => {
  const { jobs } = workflow('validation.yml');
  const select = jobs.select.steps.find((step) => step.id === 'select');
  assert.equal(select.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.match(select.run, /node scripts\/ci\/select-validation\.mjs/);
  assert.equal(jobs.validation.if, '${{ !cancelled() }}');
  assert.equal(jobs.validation.with.tree_validated, "${{ needs.select.outputs.scope == 'skip' }}");
  assert.equal(jobs.browsers.if, "${{ !cancelled() && needs.select.outputs.scope != 'skip' }}");
  for (const job of ['validation', 'browsers', 'gate'])
    assert.ok(jobs[job].needs.includes('select'));
  const require = jobs.gate.steps[0];
  assert.match(require.run, /test "\$VALIDATION_RESULT" = success/);
  assert.match(
    require.run,
    /if \[ "\$SCOPE" = skip \]; then\n\s+test "\$BROWSER_RESULT" = skipped/,
  );
  assert.match(require.run, /else\n\s+test "\$BROWSER_RESULT" = success/);
});

test('an already validated tree skips every gate job except the sign-off check', () => {
  const { jobs, on } = workflow('gate.yml');
  assert.equal(on.workflow_call.inputs.tree_validated.type, 'boolean');
  assert.doesNotMatch(jobs.dco.if, /tree_validated/);
  assert.match(jobs.dco.if, /github\.event_name == 'push'/);
  const skipped = (name) =>
    /!inputs\.tree_validated/.test(jobs[name].if ?? '') ||
    [jobs[name].needs ?? []].flat().some(skipped);
  for (const name of Object.keys(jobs).filter((job) => job !== 'dco'))
    assert.ok(skipped(name), `${name} would run again on an already validated tree`);
});
