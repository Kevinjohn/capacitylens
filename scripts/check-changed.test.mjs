import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  changedPaths,
  planChecks,
  ranNoTests,
  runStep,
  selectE2eSpecs,
  staticScope,
  testCount,
  toolingScope,
} from './check-changed.mjs';

const everything = () => true;
const noImporters = () => [];
const labels = (steps) => steps.map((step) => step.label);
const step = (steps, prefix) => steps.find((candidate) => candidate.label.startsWith(prefix));

test('a backend spec-only change runs each spec through its own --files flag', () => {
  const steps = planChecks(
    ['apps/backend/tests/functional/a.spec.ts', 'apps/backend/tests/unit/b.spec.ts'],
    everything,
  );
  assert.deepEqual(step(steps, 'test: 2 backend spec').args, [
    '--dir',
    'apps/backend',
    'test',
    '--files',
    'tests/functional/a.spec.ts',
    '--files',
    'tests/unit/b.spec.ts',
  ]);
  assert.ok(step(steps, 'prepare: build @capacitylens/shared'));
  assert.equal(step(steps, 'test: backend suite'), undefined);
});

test('backend source or shared package changes run the full backend suite', () => {
  for (const path of [
    'apps/backend/app/services/planning.ts',
    'packages/shared/src/domain/errors.ts',
  ]) {
    const steps = planChecks([path, 'apps/backend/tests/unit/b.spec.ts'], everything);
    assert.deepEqual(
      step(steps, 'test: backend suite').args,
      ['--dir', 'apps/backend', 'test'],
      path,
    );
    assert.equal(step(steps, 'test: 1 backend spec'), undefined, path);
    assert.ok(step(steps, 'prepare: build @capacitylens/shared'), path);
    assert.equal(step(steps, 'prepare: build backend client types'), undefined, path);
  }
});

test('frontend and shared source run related frontend tests, lint and the type-check', () => {
  const steps = planChecks(
    ['apps/frontend/src/App.tsx', 'packages/shared/src/lib/color.ts'],
    everything,
  );
  assert.deepEqual(step(steps, 'test: frontend tests related').args.slice(-2), [
    '../../apps/frontend/src/App.tsx',
    '../../packages/shared/src/lib/color.ts',
  ]);
  assert.deepEqual(step(steps, 'lint: frontend').args.slice(-1), ['src/App.tsx']);
  assert.deepEqual(step(steps, 'lint: 1 file').args.slice(-1), [
    'packages/shared/src/lib/color.ts',
  ]);
  assert.ok(step(steps, 'prepare: compile messages'));
  assert.deepEqual(step(steps, 'prepare: build backend client types').args, [
    '--dir',
    'apps/backend',
    'typecheck:client',
  ]);
  assert.ok(step(steps, 'typecheck'));
});

test('shared package metadata runs the full frontend suite and type-check', () => {
  for (const path of ['packages/shared/package.json', 'packages/shared/tsconfig.json']) {
    const steps = planChecks([path], everything);
    assert.deepEqual(
      step(steps, 'test: frontend suite').args,
      ['--dir', 'apps/frontend', 'exec', 'vitest', 'run'],
      path,
    );
    assert.equal(step(steps, 'test: frontend tests related'), undefined, path);
    assert.ok(step(steps, 'typecheck'), path);
    assert.ok(step(steps, 'test: backend suite'), path);
  }
});

test('deleted shared metadata runs the full frontend suite without passing deleted paths to tools', () => {
  const deleted = 'packages/shared/tsconfig.json';
  const steps = planChecks([deleted], (path) => path !== deleted);
  assert.deepEqual(step(steps, 'test: frontend suite').args, [
    '--dir',
    'apps/frontend',
    'exec',
    'vitest',
    'run',
  ]);
  assert.ok(step(steps, 'typecheck'));
  assert.ok(step(steps, 'test: backend suite'));
  assert.equal(step(steps, 'lint: 1 file'), undefined);
  assert.equal(step(steps, 'format'), undefined);
});

test('shared metadata mixed with source uses the full frontend suite', () => {
  const steps = planChecks(
    ['packages/shared/package.json', 'packages/shared/src/lib/color.ts'],
    everything,
  );
  assert.ok(step(steps, 'test: frontend suite'));
  assert.equal(step(steps, 'test: frontend tests related'), undefined);
  assert.deepEqual(step(steps, 'lint: 1 file').args.slice(-1), [
    'packages/shared/src/lib/color.ts',
  ]);
});

test('shared documentation and source-only changes do not select the full frontend suite', () => {
  const readme = planChecks(['packages/shared/README.md'], everything);
  assert.equal(step(readme, 'test: frontend suite'), undefined);
  assert.equal(step(readme, 'typecheck'), undefined);

  const source = planChecks(['packages/shared/src/lib/color.ts'], everything);
  assert.ok(step(source, 'test: frontend tests related'));
  assert.equal(step(source, 'test: frontend suite'), undefined);
});

test('frontend configuration outside src runs the whole frontend suite', () => {
  const steps = planChecks(
    ['apps/frontend/vite.config.ts', 'apps/frontend/src/App.tsx'],
    everything,
  );
  assert.deepEqual(step(steps, 'test: frontend suite').args, [
    '--dir',
    'apps/frontend',
    'exec',
    'vitest',
    'run',
  ]);
  assert.equal(step(steps, 'test: frontend tests related'), undefined);
});

test('deleted paths select checks but are never passed to file tools', () => {
  const deleted = 'apps/backend/app/services/removed.ts';
  const steps = planChecks([deleted, 'README.md'], (path) => path !== deleted);
  assert.ok(step(steps, 'typecheck'));
  assert.ok(step(steps, 'test: backend suite'));
  assert.equal(step(steps, 'lint: backend'), undefined);
  assert.deepEqual(step(steps, 'format').args.slice(-1), ['README.md']);
});

test('a changed script runs its own test file when one exists', () => {
  const steps = planChecks(
    ['scripts/lanes.mjs', 'scripts/bundleBudget.mjs'],
    (path) => path !== 'scripts/bundleBudget.test.mjs',
    noImporters,
  );
  assert.deepEqual(step(steps, 'test: 1 script test').args, ['--test', 'scripts/lanes.test.mjs']);
  assert.equal(step(steps, 'test: 1 script test').command, 'node');
});

test('a changed script also runs the differently named test files that import it', () => {
  const steps = planChecks(['scripts/gateCommands.mjs'], everything, (path) =>
    path === 'scripts/gateCommands.mjs'
      ? ['scripts/run-gate.test.mjs', 'scripts/check-dependabot.test.mjs']
      : [],
  );
  assert.deepEqual(step(steps, 'test: 3 script test').args, [
    '--test',
    'scripts/gateCommands.test.mjs',
    'scripts/run-gate.test.mjs',
    'scripts/check-dependabot.test.mjs',
  ]);
  assert.deepEqual(
    step(
      planChecks(['scripts/gateCommands.mjs'], (path) => !path.endsWith('gateCommands.test.mjs')),
      'test:',
    ).args,
    ['--test', 'scripts/check-dependabot.test.mjs', 'scripts/run-gate.test.mjs'],
  );
});

test('a lint or format configuration change checks the whole repository', () => {
  const lint = planChecks(
    ['apps/backend/eslint.config.js', 'apps/frontend/src/App.tsx'],
    everything,
  );
  assert.deepEqual(step(lint, 'lint: whole repository').args, ['run', 'lint']);
  assert.equal(step(lint, 'lint: frontend'), undefined);
  assert.equal(step(lint, 'lint: backend'), undefined);
  const format = planChecks(['.prettierignore', 'README.md'], everything);
  assert.deepEqual(step(format, 'format').args, ['run', 'format:check']);
});

test('a dependency or workspace change runs the type-check and both full suites', () => {
  for (const path of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'package.json']) {
    const planned = labels(planChecks([path], everything));
    for (const expected of ['typecheck', 'test: frontend suite', 'test: backend suite'])
      assert.ok(planned.includes(expected), `${path}: ${expected}`);
  }
});

test('backend lint allows warnings like its own lint script; the others refuse them', () => {
  const steps = planChecks(
    ['apps/backend/app/a.ts', 'apps/frontend/src/App.tsx', 'scripts/lanes.mjs'],
    everything,
  );
  assert.equal(step(steps, 'lint: backend').args.includes('--max-warnings'), false);
  assert.ok(step(steps, 'lint: frontend').args.includes('--max-warnings'));
  assert.ok(step(steps, 'lint: 1 file').args.includes('--max-warnings'));
});

const staticOnly = { staticOnly: true };
const skipped = (steps) =>
  steps.filter((candidate) => candidate.skip).map((candidate) => candidate.label);

test('--static runs changed test files on their own and skips every whole suite', () => {
  const steps = planChecks(
    [
      'pnpm-lock.yaml',
      'apps/backend/app/services/planning.ts',
      'apps/backend/tests/unit/b.spec.ts',
      'apps/frontend/src/App.test.tsx',
      'packages/shared/src/lib/color.test.ts',
    ],
    everything,
    noImporters,
    staticOnly,
  );
  assert.deepEqual(step(steps, 'test: 1 backend spec').args, [
    '--dir',
    'apps/backend',
    'test',
    '--files',
    'tests/unit/b.spec.ts',
  ]);
  assert.deepEqual(step(steps, 'test: 2 frontend test').args, [
    '--dir',
    'apps/frontend',
    'exec',
    'vitest',
    'run',
    'src/App.test.tsx',
    'packages/shared/src/lib/color.test.ts',
  ]);
  assert.deepEqual(skipped(steps), ['test: frontend suite', 'test: backend suite']);
  assert.ok(step(steps, 'typecheck'));
  assert.ok(step(steps, 'format'));
});

test("--static skips the related-test lookup for source but not the source's lint and type-check", () => {
  const steps = planChecks(['apps/frontend/src/App.tsx'], everything, noImporters, staticOnly);
  assert.deepEqual(skipped(steps), ['test: frontend tests related to changes']);
  assert.ok(step(steps, 'lint: frontend'));
  assert.ok(step(steps, 'typecheck'));
  assert.equal(
    skipped(planChecks(['apps/frontend/src/App.test.tsx'], everything, noImporters, staticOnly))
      .length,
    0,
  );
});

test("backend tests build the application first when its output is missing, with CI's build environment", () => {
  const missingBuild = (path) => path !== 'apps/backend/public/assets';
  for (const [paths, options] of [
    [['apps/backend/app/services/planning.ts'], {}],
    [['apps/backend/tests/unit/b.spec.ts'], staticOnly],
  ]) {
    const steps = planChecks(paths, missingBuild, noImporters, options);
    const build = step(steps, 'prepare: build application');
    assert.deepEqual(build?.args, ['run', 'build'], paths[0]);
    assert.equal(build.env.NODE_ENV, 'production');
    assert.ok(
      labels(steps).indexOf('prepare: build application') <
        labels(steps).findIndex((label) => label.startsWith('test:')),
    );
  }
  assert.equal(
    step(planChecks(['apps/backend/app/a.ts'], everything), 'prepare: build application'),
    undefined,
  );
  assert.equal(
    step(planChecks(['apps/frontend/src/App.tsx'], missingBuild), 'prepare: build application'),
    undefined,
  );
  assert.equal(
    step(
      planChecks(['apps/backend/app/a.ts'], missingBuild, noImporters, staticOnly),
      'prepare: build application',
    ),
    undefined,
  );
});

test("a step's own environment reaches the process it starts", async () => {
  const result = await runStep({
    label: 'test: environment',
    command: 'node',
    args: ['-e', "process.stdout.write(process.env.CHECK_CHANGED_PROBE ?? 'missing')"],
    env: { CHECK_CHANGED_PROBE: 'present' },
  });
  assert.equal(result.output, 'present');
});

test('a renamed file is listed under both its old and new paths', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'check-changed-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
      cwd: repo,
    });
  git('init', '-q');
  writeFileSync(join(repo, 'old.mjs'), 'export const value = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  renameSync(join(repo, 'old.mjs'), join(repo, 'new.mjs'));
  git('add', '-A');
  git('commit', '-q', '-m', 'rename');
  assert.deepEqual(changedPaths('HEAD~1', repo), ['new.mjs', 'old.mjs']);
});

test('a step that ignores SIGTERM after its time limit is killed and fails', async () => {
  const started = Date.now();
  // The child gives up after 10 seconds by itself, so a missing SIGKILL fails this test instead of hanging it.
  const result = await runStep(
    {
      label: 'test: stubborn',
      command: 'node',
      args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10_000);"],
    },
    { timeoutMs: 300, killGraceMs: 300 },
  );
  assert.ok(Date.now() - started < 5_000, 'the step was not killed');
  assert.equal(result.passed, false);
  assert.match(result.output, /stopped after 0\.3 seconds/);
});

test('documentation sources rebuild docs/ and end-to-end specs are reported as skipped', () => {
  const steps = planChecks(['docs-src/index.md', 'e2e/smoke.spec.ts'], everything);
  assert.equal(step(steps, 'docs').docsClean, true);
  assert.equal(typeof step(steps, 'e2e').skip, 'string');
  assert.deepEqual(labels(steps).slice(-2), ['docs: build and compare docs/', 'e2e']);
});

test('deleted files and documentation policy inputs run the documentation policy spec', () => {
  const policy = 'apps/backend/tests/functional/policy/documentation_policy.spec.ts';
  for (const [paths, exists] of [
    [['apps/frontend/src/components/a.test.tsx'], (path) => path === policy],
    [['user-stories/navigation/US-NAV-15.md'], everything],
    [['README.md'], everything],
    [['CHANGELOG-ARCHIVE.md'], everything],
  ]) {
    const files = step(planChecks(paths, exists), 'test: 1 backend spec').args;
    assert.deepEqual(files.slice(-2), ['--files', policy.slice('apps/backend/'.length)], paths[0]);
  }
  const both = planChecks([policy, 'user-stories/a.md'], everything);
  assert.ok(step(both, 'test: 1 backend spec'));
  assert.equal(
    step(planChecks(['apps/frontend/src/a.ts'], everything), 'test: 1 backend spec'),
    undefined,
  );
});

test('prepare steps run before every check', () => {
  const steps = planChecks(['apps/frontend/src/App.tsx', 'apps/backend/app/a.ts'], everything);
  const firstCheck = steps.findIndex((candidate) => !candidate.prepare);
  assert.ok(steps.slice(firstCheck).every((candidate) => !candidate.prepare));
  assert.equal(steps[0].label, 'prepare: stop leftover servers');
});

test('a focused test step that executes nothing fails, while related tests may find none', () => {
  const specs = step(
    planChecks(['apps/backend/tests/unit/b.spec.ts'], everything),
    'test: 1 backend spec',
  );
  assert.equal(
    ranNoTests(specs, 'booting application to run tests...\n\n NO TESTS EXECUTED\n'),
    true,
  );
  assert.equal(ranNoTests(specs, ' PASSED \nTests  4 passed (4)\n'), false);
  const scripts = step(
    planChecks(['scripts/lanes.mjs'], everything, noImporters),
    'test: 1 script test',
  );
  assert.equal(ranNoTests(scripts, '# tests 0\n# pass 0\n'), true);
  assert.equal(ranNoTests(scripts, 'ℹ tests 3\nℹ pass 3\n'), false);
  const related = step(
    planChecks(['apps/frontend/src/App.tsx'], everything),
    'test: frontend tests related',
  );
  assert.equal(ranNoTests(related, 'No test files found, exiting with code 0\n'), false);
});

test('a passing test step reports how many tests it ran', () => {
  assert.equal(testCount(' Test Files  136 passed (136)\n      Tests  1743 passed (1743)\n'), 1743);
  assert.equal(testCount(' PASSED \n\nTests  63 passed (63)\n Time  8s\n'), 63);
  assert.equal(testCount('ℹ tests 9\nℹ pass 9\n'), 9);
  assert.equal(testCount('# tests 4\n# pass 4\n'), 4);
  assert.equal(testCount('No test files found, exiting with code 0\n'), undefined);
});

test('deleted frontend implementation selects full tests without missing file arguments', () => {
  const deleted = 'apps/frontend/src/removed.ts';
  for (const staticOnly of [false, true]) {
    const steps = planChecks([deleted], () => false, noImporters, { staticOnly });
    const selected = step(steps, 'test: frontend suite');
    assert.ok(selected);
    if (staticOnly) assert.ok(selected.skip);
    else assert.deepEqual(selected.args, ['--dir', 'apps/frontend', 'exec', 'vitest', 'run']);
    assert.ok(step(steps, 'typecheck'));
    assert.ok(steps.every((entry) => !entry.args?.includes(deleted)));
  }
});

test('changed end-to-end specs are selected on their own, alongside application changes', () => {
  assert.deepEqual(selectE2eSpecs(['e2e/typed-writers.auth.spec.ts'], everything).specs, [
    'e2e/typed-writers.auth.spec.ts',
  ]);
  assert.deepEqual(
    selectE2eSpecs(
      ['apps/frontend/src/App.tsx', 'e2e/a.spec.ts', 'e2e/b.db.spec.ts', 'e2e/gone.spec.ts'],
      (path) => path !== 'e2e/gone.spec.ts',
    ).specs,
    ['e2e/a.spec.ts', 'e2e/b.db.spec.ts'],
  );
});

test('end-to-end support changes select the Chromium and auth suites; deleted specs and no end-to-end change select nothing', () => {
  for (const [paths, run, reason] of [
    [['e2e/a.spec.ts', 'e2e/fixtures.ts'], 'suite', /support file.+e2e\/fixtures\.ts/],
    [['playwright.config.ts'], 'suite', /support file/],
    [['scripts/playwrightRunMode.mjs'], 'suite', /support file/],
    [['e2e/gone.spec.ts'], 'none', /only deleted/],
    [['apps/frontend/src/App.tsx'], 'none', /no end-to-end changes/],
  ]) {
    const selection = selectE2eSpecs(paths, (path) => path !== 'e2e/gone.spec.ts');
    assert.equal(selection.run, run, paths.join());
    assert.deepEqual(selection.specs, [], paths.join());
    assert.match(selection.reason, reason);
  }
  assert.equal(selectE2eSpecs(['e2e/a.spec.ts'], everything).run, 'specs');
});

test('selection modes cannot be combined', () => {
  for (const pair of [
    ['--static', '--e2e-plan'],
    ['--tests-only', '--static'],
    ['--static-scope', '--tests-only'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./check-changed.mjs', import.meta.url)), ...pair],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2, pair.join(' '));
    assert.match(result.stderr, /Expected at most one of/);
  }
});

test('the selection modes load no installed dependency, so CI can select before installing', () => {
  const source = readFileSync(new URL('./check-changed.mjs', import.meta.url), 'utf8');
  const staticImports = source.match(/^import .+ from '[^']+';$/gm);
  assert.ok(
    staticImports.every((line) => /from '(?:node:[^']+|\.\.\/apps\/[^']+\.ts)'/.test(line)),
  );
});

const testsOnly = { testsOnly: true };
const noBackendImporters = { backendImporters: () => [] };

test('--tests-only leaves format, lint, the type-check and the docs build to their own workflows', () => {
  const paths = [
    'apps/frontend/src/App.tsx',
    'scripts/lanes.mjs',
    'eslint.config.js',
    'docs-src/index.md',
  ];
  const full = planChecks(paths, everything, noImporters);
  const steps = planChecks(paths, everything, noImporters, testsOnly);
  for (const label of ['format', 'lint: whole repository', 'typecheck', 'docs: build']) {
    assert.ok(step(full, label)?.args, label);
    assert.equal(typeof step(steps, label).skip, 'string', label);
    assert.equal(step(steps, label).args, undefined, label);
  }
  assert.equal(step(steps, 'prepare: compile messages'), undefined);
  assert.equal(step(steps, 'prepare: build backend client types'), undefined);
  assert.ok(step(steps, 'test: frontend tests related').args);
  assert.ok(step(steps, 'test: 1 script test').args);
});

test('a documentation-only change formats, runs the documentation policy spec and needs no build', () => {
  const missingBuild = (path) => path !== 'apps/backend/public/assets';
  const steps = planChecks(['README.md'], missingBuild, noImporters, testsOnly);
  assert.deepEqual(
    steps
      .filter((candidate) => candidate.args && !candidate.prepare)
      .map((candidate) => candidate.label),
    ['test: 1 backend spec file(s)'],
  );
  assert.equal(step(steps, 'prepare: build application'), undefined);
  assert.ok(step(steps, 'format').skip);
  assert.deepEqual(
    staticScope(['README.md', 'docs-src/a.md', 'docs/a.html', 'user-stories/b.md']),
    {
      scope: 'format',
      reason: '4 documentation-only path(s)',
    },
  );
  assert.equal(staticScope(['README.md', 'apps/frontend/src/App.tsx']).scope, 'full');
  assert.equal(staticScope(['package.json']).scope, 'full');
});

test('a backend source change runs the specs that import it, with the reason and a build', () => {
  const missingBuild = (path) => path !== 'apps/backend/public/assets';
  const importers = (path) =>
    path === 'apps/backend/app/services/planning/execute.ts'
      ? ['apps/backend/tests/unit/planning/execute.spec.ts']
      : [];
  const steps = planChecks(
    ['apps/backend/app/services/planning/execute.ts', 'apps/backend/README.md'],
    missingBuild,
    noImporters,
    { backendImporters: importers },
  );
  const specs = step(steps, 'test: 1 backend spec');
  assert.deepEqual(specs.args.slice(-2), ['--files', 'tests/unit/planning/execute.spec.ts']);
  assert.match(
    specs.reason,
    /unit\/planning\/execute\.spec\.ts: imports apps\/backend\/app\/services\/planning\/execute\.ts/,
  );
  assert.equal(step(steps, 'test: backend suite'), undefined);
  assert.ok(step(steps, 'prepare: build application'));
  const quick = planChecks(
    ['apps/backend/app/services/planning/execute.ts'],
    everything,
    noImporters,
    {
      backendImporters: importers,
      staticOnly: true,
    },
  );
  assert.ok(step(quick, 'test: backend specs importing changes').skip);
});

test('permissions, schema, configuration, test infrastructure and unmapped backend changes run the whole backend suite', () => {
  const importedByEverything = () => ['apps/backend/tests/unit/a.spec.ts'];
  for (const path of [
    'apps/backend/app/services/auth/authorization.ts',
    'apps/backend/app/services/account_kit/policy.ts',
    'apps/backend/app/services/membership/member_directory.ts',
    'apps/backend/app/services/planning/data_policy.ts',
    'apps/backend/app/middleware/company_scope_middleware.ts',
    'apps/backend/app/models/scoped_model.ts',
    'apps/backend/database/migrations/0001_baseline.ts',
    'apps/backend/start/routes.ts',
    'apps/backend/config/admission.ts',
    'apps/backend/tests/helpers/state_fixture.ts',
    'apps/backend/package.json',
  ]) {
    const suite = step(
      planChecks([path], everything, noImporters, { backendImporters: importedByEverything }),
      'test: backend suite',
    );
    assert.ok(suite?.args, path);
    assert.match(suite.reason, /permission, schema, configuration or test infrastructure/, path);
  }
  const unmapped = step(
    planChecks(
      ['apps/backend/app/controllers/planning_controller.ts'],
      everything,
      noImporters,
      noBackendImporters,
    ),
    'test: backend suite',
  );
  assert.match(
    unmapped.reason,
    /no backend spec imports apps\/backend\/app\/controllers\/planning_controller\.ts/,
  );
  for (const [path, reason] of [
    ['packages/shared/src/domain/errors.ts', /shared contract/],
    ['pnpm-lock.yaml', /dependencies/],
  ])
    assert.match(
      step(planChecks([path], everything, noImporters, noBackendImporters), 'test: backend suite')
        .reason,
      reason,
      path,
    );
});

test('every step that runs a command says why it was selected', () => {
  const steps = planChecks(
    [
      'README.md',
      'eslint.config.js',
      'apps/frontend/src/App.tsx',
      'apps/backend/app/services/planning/execute.ts',
      'scripts/lanes.mjs',
      'docs-src/index.md',
    ],
    everything,
    noImporters,
    noBackendImporters,
  );
  for (const candidate of steps.filter((entry) => entry.args && !entry.prepare))
    assert.ok(candidate.reason, candidate.label);
});

test('main validation skips tooling checks only for application source, tests and prose', () => {
  for (const paths of [
    ['apps/backend/app/services/planning/execute.ts', 'apps/backend/tests/unit/a.spec.ts'],
    ['apps/frontend/src/App.tsx', 'apps/frontend/messages/en.json', 'packages/shared/src/a.ts'],
    ['README.md', 'user-stories/a.md', 'apps/backend/database/migrations/a.ts'],
  ])
    assert.equal(toolingScope(paths).scope, 'skip', paths.join());
  for (const path of [
    'scripts/lanes.mjs',
    '.github/workflows/gate.yml',
    'pnpm-lock.yaml',
    'package.json',
    'apps/frontend/src/index.css',
    'apps/frontend/vite.config.ts',
    'apps/backend/scripts/e2e-server.mjs',
    'docs-src/screenshots/publication-review.json',
    'packaging/README.txt',
    '.gitleaks.toml',
    'e2e/fixtures.ts',
  ]) {
    const selected = toolingScope(['apps/frontend/src/App.tsx', path]);
    assert.equal(selected.scope, 'run', path);
    assert.match(selected.reason, new RegExp(path.replaceAll('.', '\\.')));
  }
});
