// Check only what this branch changed, before the full gate:
//
//   pnpm run check:changed           changes since the merge-base with origin/main
//   pnpm run check:changed <base>    changes since the merge-base with <base>
//   pnpm run check:changed --plan    preview the combined checks, in execution order
//   pnpm run check:changed --static  the same, without dependency lookups or whole test suites
//   pnpm run check:changed --tests-only
//                                    only the tests; CI's static analysis job owns format, lint and
//                                    the type-check, and the docs workflow owns the docs build
//   node scripts/ci/check-changed.mjs --push
//                                    only format, lint and the type-check, for the pre-push hook;
//                                    the pull request's checks run the tests and the docs build
//   node scripts/ci/check-changed.mjs --static-scope [<base>]
//                                    print `full`, or `format` when only documentation changed
//   node scripts/ci/check-changed.mjs --tooling-scope [<base>]
//                                    print `run` when a tooling-policy input changed, else `skip`
//   node scripts/ci/check-changed.mjs --e2e-plan [<base>]
//                                    print the browser work as JSON: no run, changed specs, or
//                                    the Chromium and auth suites when shared browser inputs changed
//
// Every planned step carries the reason it was selected; under GitHub Actions the plan and its
// results are also written to the job summary.
//
// Uncommitted and untracked files count as changed. `pnpm run gate:all` and `pnpm run e2e` remain
// the submission gate; this is the fast loop while implementing or reviewing a change.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSupportedNodeVersion } from '../../apps/backend/bin/node_version.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const defaultBase = 'origin/main';
// A step that never exits must still fail, and a hung step may not answer SIGTERM, hence SIGKILL.
const stepLimits = { timeoutMs: 20 * 60_000, killGraceMs: 10_000 };
const logTailLines = 40;

const codeFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const typeInput = /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$/;
const backendSpec = /^apps\/backend\/tests\/.+\.spec\.ts$/;
const frontendTest =
  /^(?:apps\/frontend\/src\/.+\.(?:test|spec)\.tsx?|packages\/shared\/.+\.(?:test|spec)\.ts)$/;
// Reads the built documentation site, so the default frontend suite excludes it and only the docs
// steps (build, then `docs:test`) can run it.
const docsSiteTest = 'apps/frontend/src/test/docs-lightbox.test.ts';
// Backend static file tests read the built application, which a fresh worktree lacks.
const appBuildOutput = 'apps/backend/public/assets';
// CI builds the application before backend tests with these fixed, non-secret values
// (.github/workflows/gate.yml).
const appBuildEnvironment = {
  NODE_ENV: 'production',
  CAPACITYLENS_PUBLIC_URL: 'https://127.0.0.1',
  HOST: '127.0.0.1',
  PORT: '0',
  LOG_LEVEL: 'error',
  APP_KEY: 'capacitylens-test-key-0123456789abcdef',
  APP_URL: 'http://127.0.0.1',
};
// A rule or ignore change can fail files the branch never touched.
const lintConfig = /(?:^|\/)eslint\.config\.[cm]?js$/;
const formatConfig = /^\.prettier(?:rc[^/]*|ignore)$/;
// `check:ui` pins the source-owned shadcn primitives and the tooling that fetches them.
const uiPrimitiveInput =
  /^(?:apps\/frontend\/src\/components\/ui\/|\.mcp\.json$|scripts\/maintenance\/(?:check-ui-primitives|ui-registry)\.mjs$)/;
// Dependency and workspace changes can break any package without touching its sources.
const workspaceInput = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/;
// Paths that format:check covers but lint and the type-check do not.
const documentationOnly = /^(?:docs-src\/|docs\/|user-stories\/)|\.md$/;
// Backend inputs a spec import cannot map: permissions, company data access, middleware, schema and
// migrations, configuration, test infrastructure and package files. Any change here runs the
// whole suite.
const backendSuiteInput =
  /^apps\/backend\/(?:(?:database|config|start|providers|bin|commands|types|scripts)\/|app\/(?:middleware|exceptions|models|models_support)\/|app\/services\/(?:auth|account_kit|access_control|admission|membership)\/|app\/services\/state_repository\.ts$|tests\/(?!.+\.spec\.ts$)|[^/]+$)/;
const backendPermissionFile =
  /^apps\/backend\/app\/services\/planning\/(?:access_grant|entity_rules)\.ts$/;
const backendModule = /^apps\/backend\/app\/([^/]+)\/(.+)\.ts$/;
const backendTests = 'apps/backend/tests/';
// Application source, tests and prose that no tooling-policy check reads. The Sonner CSP test reads
// the frontend stylesheet, so it stays a tooling input.
const applicationOnly =
  /^(?:apps\/backend\/(?:app|tests|database)\/|apps\/frontend\/(?:src|messages)\/(?!index\.css$)|packages\/shared\/src\/|user-stories\/)|\.md$/;
// The documentation policy spec reads these files and checks that every path a user story links
// still exists, so a deleted file or a change to them can fail it without touching backend code.
const documentationPolicySpec = 'apps/backend/tests/functional/conventions/documentation.spec.ts';
const documentationPolicyInput =
  /^(?:user-stories\/|docs-src\/|packaging\/|apps\/frontend\/messages\/|README\.md$)/;
// A filter that matches nothing reports success; these markers turn it into a failure.
// Specs run on their own; any other end-to-end input can affect every spec.
const e2eSpec = /^e2e\/.+\.spec\.ts$/;
const e2eInput = /^(?:e2e\/|tooling\/|playwright\.config\.ts$|scripts\/e2e\/playwright)/;
const japaNoTests = /NO TESTS EXECUTED/;
const nodeTestNoTests = /^(?:# |ℹ )tests 0$/m;
// Vitest and Japa summarise as "Tests  12 passed (12)"; node --test reports "tests 12".
const testCounts = [/^\s*Tests\s+(\d+) passed/m, /^(?:# |ℹ )tests (\d+)$/m];

// The terminology list, its checker and the dictionary it enforces: a change to any of them can fail
// files the branch never touched, so the whole tree is checked.
const terminologyInput =
  /^(?:tooling\/terminology\.mjs|scripts\/maintenance\/check-terminology\.mjs|code_convention_terminology\.md)$/;

const relativeTo = (prefix) => (path) => path.slice(prefix.length);

/** List the script and tooling test files that import a changed `.mjs` file, whatever they are called. */
function scriptTestsImporting(path) {
  return ['scripts', 'tooling']
    .flatMap((directory) =>
      readdirSync(new URL(`${directory}/`, pathToFileURL(root)), { recursive: true }).map(
        (entry) => `${directory}/${entry.split('\\').join('/')}`,
      ),
    )
    .filter((test) => {
      if (!test.endsWith('.test.mjs')) return false;
      const target = posix.relative(posix.dirname(test), path);
      // Prettier keeps every import specifier single-quoted, so the closing quote is part of the match.
      const specifier = `${target.startsWith('../') ? '' : './'}${target}'`;
      return readFileSync(new URL(test, pathToFileURL(root)), 'utf8').includes(specifier);
    });
}

/**
 * List the backend spec files whose source imports `apps/backend/app/<dir>/<name>.ts` through
 * `#<dir>/<name>`. Returns `null` when a shared test helper imports it, because every spec that
 * uses that helper depends on it and no import list shows which. `sources` holds
 * `[path, source]` pairs for the backend test files.
 */
export function backendSpecsImportingFrom(path, sources) {
  const [, directory, name] = backendModule.exec(path) ?? [];
  if (!directory) return [];
  const specifier = `'#${directory}/${name}'`;
  const importers = sources.filter(([, source]) => source.includes(specifier));
  if (importers.some(([file]) => !backendSpec.test(file))) return null;
  return importers.map(([file]) => file);
}

let testSources;
function backendSpecsImporting(path) {
  testSources ??= readdirSync(new URL(backendTests, pathToFileURL(root)), { recursive: true })
    .map((entry) => `${backendTests}${entry.split('\\').join('/')}`)
    .filter((file) => /\.ts$/.test(file))
    .map((file) => [file, readFileSync(new URL(file, pathToFileURL(root)), 'utf8')]);
  return backendSpecsImportingFrom(path, testSources);
}

const summarise = (reasons) =>
  reasons.length > 3
    ? `${reasons.slice(0, 3).join('; ')}; and ${reasons.length - 3} more`
    : reasons.join('; ');

/**
 * Decide whether static analysis needs lint and the type-check, or only formatting.
 *
 * Documentation paths are formatted but neither linted nor type-checked, so a change made only of
 * them needs `format:check` alone.
 */
export function staticScope(paths) {
  const code = paths.filter((path) => !documentationOnly.test(path));
  if (code.length)
    return {
      scope: 'full',
      reason: `${code.length} path(s) outside documentation, such as ${code[0]}`,
    };
  return { scope: 'format', reason: `${paths.length} documentation-only path(s)` };
}

/**
 * Decide whether main validation runs the tooling-policy checks.
 *
 * They read scripts, workflows, package and lock files, packaging, documentation assets and a few
 * application configuration files, so a change confined to application source, tests and prose
 * skips them. Scheduled, release and manual validation run them all.
 */
export function toolingScope(paths) {
  const inputs = paths.filter((path) => !applicationOnly.test(path));
  if (inputs.length)
    return {
      scope: 'run',
      reason: `${inputs.length} tooling input(s) changed, such as ${inputs[0]}`,
    };
  return {
    scope: 'skip',
    reason: paths.length
      ? `${paths.length} path(s), all application source, tests or prose`
      : 'no changes',
  };
}

/**
 * Plan the checks for a branch's changed paths, in run order.
 *
 * Deleted paths still select suites and the type-check, but are never passed to a tool that
 * expects existing files. With `staticOnly`, changed test files run on their own and every
 * dependency lookup or whole suite becomes a skip line, for changes that share one full run.
 * With `testsOnly`, format, lint, the type-check and the docs build become skip lines, because CI
 * runs them in their own workflows. With `pushOnly`, the reverse: only format, lint and the
 * type-check run, with what lint needs prepared, and every test and the docs build become skip
 * lines, because the pull request's checks run them.
 *
 * A backend source change runs the specs that import it. Shared contracts, dependencies,
 * permissions, company data access, schema, configuration, test infrastructure, modules a shared
 * test helper imports and backend changes no spec imports run the whole backend suite instead. Every step carries the reason it was selected.
 */
export function planChecks(
  paths,
  exists = (path) => existsSync(new URL(path, pathToFileURL(root))),
  testsImporting = scriptTestsImporting,
  {
    staticOnly = false,
    testsOnly = false,
    pushOnly = false,
    backendImporters = backendSpecsImporting,
  } = {},
) {
  const steps = planAllChecks(paths, exists, testsImporting, { staticOnly, backendImporters });
  if (pushOnly)
    return steps
      .filter((step) => !step.prepare || step.forLint)
      .map((step) =>
        step.prepare || step.skip || step.owner === 'static'
          ? step
          : { label: step.label, skip: "the pull request's checks run it", reason: step.reason },
      );
  if (!testsOnly) return steps;
  const owners = {
    static: 'the static analysis job runs it',
    docs: 'the docs workflow builds and checks the site',
  };
  return steps
    .filter((step) => !step.forLint)
    .map((step) =>
      owners[step.owner]
        ? { label: step.label, skip: owners[step.owner], reason: step.reason }
        : step,
    );
}

function planAllChecks(paths, exists, testsImporting, { staticOnly, backendImporters }) {
  const present = paths.filter(exists);
  const presentCode = present.filter((path) => codeFile.test(path));
  const backendSources = paths.filter(
    (path) => path.startsWith('apps/backend/') && !backendSpec.test(path) && !path.endsWith('.md'),
  );
  const sharedChanged = paths.some((path) => path.startsWith('packages/shared/'));
  const sharedMetadataChanged = paths.some(
    (path) => path.startsWith('packages/shared/') && typeInput.test(path),
  );
  const workspaceChanged = paths.some((path) => workspaceInput.test(path));

  const suiteReasons = [];
  if (sharedChanged) suiteReasons.push('the shared contract package changed');
  if (workspaceChanged) suiteReasons.push('dependencies or workspace configuration changed');
  // The backend loads the reset harness from tooling/, and its entry spec checks when it loads.
  if (paths.some((path) => path.startsWith('tooling/e2e_')))
    suiteReasons.push('the reset harness the backend loads changed');
  const mappedSpecs = new Map();
  for (const path of backendSources) {
    if (backendSuiteInput.test(path) || backendPermissionFile.test(path)) {
      suiteReasons.push(
        `${path} is a permission, schema, configuration or test infrastructure input`,
      );
      continue;
    }
    const importers = backendImporters(path);
    if (importers === null) {
      suiteReasons.push(`a shared backend test helper imports ${path}`);
      continue;
    }
    if (!importers.length) suiteReasons.push(`no backend spec imports ${path}`);
    for (const spec of importers) mappedSpecs.set(spec, [...(mappedSpecs.get(spec) ?? []), path]);
  }
  const backendSuite = suiteReasons.length > 0;
  const documentationPolicy = paths.some(
    (path) => !present.includes(path) || documentationPolicyInput.test(path),
  );
  const specReasons = new Map();
  if (!backendSuite || staticOnly) {
    for (const path of present.filter((candidate) => backendSpec.test(candidate)))
      specReasons.set(path, 'changed');
    if (documentationPolicy && exists(documentationPolicySpec))
      specReasons.set(
        documentationPolicySpec,
        specReasons.get(documentationPolicySpec) ??
          'a documentation input changed or a file was deleted',
      );
    if (!staticOnly)
      for (const [spec, sources] of mappedSpecs)
        if (exists(spec)) specReasons.set(spec, specReasons.get(spec) ?? `imports ${sources[0]}`);
  }
  const backendSpecs = [...specReasons.keys()];
  const frontendTests = present.filter((path) => frontendTest.test(path) && path !== docsSiteTest);
  const frontendLint = presentCode.filter((path) => path.startsWith('apps/frontend/'));
  const rootLint = presentCode.filter((path) =>
    /^(?:scripts|e2e|tooling|packages\/shared\/src)\//.test(path),
  );
  const backendLint = presentCode.filter((path) => path.startsWith('apps/backend/'));
  const related = presentCode.filter(
    (path) =>
      /^(?:apps\/frontend\/src|packages\/shared\/src)\//.test(path) && path !== docsSiteTest,
  );
  // Configuration outside src affects every frontend test, which `vitest related` cannot see.
  const frontendSuite =
    workspaceChanged ||
    sharedMetadataChanged ||
    paths.some(
      (path) =>
        path.startsWith('apps/frontend/src/') &&
        codeFile.test(path) &&
        !frontendTest.test(path) &&
        !present.includes(path),
    ) ||
    paths.some(
      (path) =>
        path.startsWith('apps/frontend/') &&
        !path.startsWith('apps/frontend/src/') &&
        !path.endsWith('.md'),
    );
  const terminologyChanged = paths.some((path) => terminologyInput.test(path));
  const scriptTests = [
    ...new Set(
      [...paths, ...(terminologyChanged ? ['tooling/terminology.mjs'] : [])]
        .filter((path) => /^(?:scripts|tooling)\/.+\.(?:mjs|ts)$/.test(path))
        .flatMap((path) => {
          if (path.endsWith('.test.mjs')) return [path];
          // A TypeScript helper has no sibling test of its own; its importers test it.
          const sibling = path.endsWith('.mjs') ? [path.replace(/\.mjs$/, '.test.mjs')] : [];
          return [...sibling, ...testsImporting(path)];
        })
        .filter(exists),
    ),
  ];

  const runsBackendSuite = backendSuite && !staticOnly;
  const steps = [
    {
      label: 'prepare: stop leftover servers',
      args: ['run', 'lanes', '--stop-orphans'],
      prepare: true,
    },
  ];
  if (runsBackendSuite || backendSpecs.length)
    steps.push({
      label: 'prepare: build @capacitylens/shared',
      args: ['--filter', '@capacitylens/shared', 'build'],
      prepare: true,
    });
  // The documentation policy spec reads repository files only, so on its own it needs no build.
  if (
    (runsBackendSuite || backendSpecs.some((spec) => spec !== documentationPolicySpec)) &&
    !exists(appBuildOutput)
  )
    steps.push({
      label: 'prepare: build application',
      args: ['run', 'build'],
      env: appBuildEnvironment,
      prepare: true,
    });
  if (frontendLint.length) {
    steps.push({
      label: 'prepare: compile messages',
      args: ['run', 'paraglide:compile'],
      prepare: true,
      forLint: true,
    });
    // Type-aware frontend lint reads backend route types through a project reference whose output
    // lives under apps/backend/node_modules: a reinstall deletes it and another commit leaves it stale.
    steps.push({
      label: 'prepare: build backend client types',
      args: ['--dir', 'apps/backend', 'typecheck:client'],
      prepare: true,
      forLint: true,
    });
  }

  const fullLint = paths.some((path) => lintConfig.test(path));
  if (paths.some((path) => formatConfig.test(path)))
    steps.push({
      label: 'format: whole repository',
      args: ['run', 'format:check'],
      owner: 'static',
      reason: 'the Prettier configuration changed',
    });
  else if (present.length)
    steps.push({
      label: `format: ${present.length} file(s)`,
      owner: 'static',
      reason: 'changed files',
      args: [
        'exec',
        'prettier',
        '--check',
        '--ignore-unknown',
        '--no-error-on-unmatched-pattern',
        ...present,
      ],
    });
  if (present.length)
    steps.push({
      label: terminologyChanged
        ? 'terminology: whole tree'
        : `terminology: ${present.length} file(s)`,
      command: 'node',
      args: ['scripts/maintenance/check-terminology.mjs', ...(terminologyChanged ? [] : present)],
      owner: 'static',
      reason: terminologyChanged
        ? 'the terminology list, its checker or the dictionary changed'
        : 'changed files',
    });
  // Each package's own lint script decides whether warnings fail: the backend's allows them.
  const eslint = ['exec', 'eslint', '--no-warn-ignored'];
  const strictEslint = [...eslint, '--max-warnings', '0'];
  if (fullLint)
    steps.push({
      label: 'lint: whole repository',
      args: ['run', 'lint'],
      owner: 'static',
      reason: 'an ESLint configuration changed',
    });
  if (!fullLint && backendLint.length)
    steps.push({
      label: `lint: backend ${backendLint.length} file(s)`,
      owner: 'static',
      reason: 'changed backend code',
      args: ['--dir', 'apps/backend', ...eslint, ...backendLint.map(relativeTo('apps/backend/'))],
    });
  if (!fullLint && frontendLint.length)
    steps.push({
      label: `lint: frontend ${frontendLint.length} file(s)`,
      owner: 'static',
      reason: 'changed frontend code',
      args: [
        '--dir',
        'apps/frontend',
        ...strictEslint,
        ...frontendLint.map(relativeTo('apps/frontend/')),
      ],
    });
  if (!fullLint && rootLint.length)
    steps.push({
      label: `lint: ${rootLint.length} file(s)`,
      args: [...strictEslint, ...rootLint],
      owner: 'static',
      reason: 'changed script, end-to-end or shared code',
    });
  if (paths.some((path) => uiPrimitiveInput.test(path)))
    steps.push({
      label: 'check:ui',
      args: ['run', 'check:ui'],
      owner: 'static',
      reason: 'a shadcn primitive or its tooling changed',
    });
  if (workspaceChanged || paths.some((path) => codeFile.test(path) || typeInput.test(path)))
    steps.push({
      label: 'typecheck',
      args: ['run', 'typecheck'],
      owner: 'static',
      reason: workspaceChanged
        ? 'dependencies or workspace configuration changed'
        : 'code or type configuration changed',
    });

  if (scriptTests.length)
    steps.push({
      label: `test: ${scriptTests.length} script test file(s)`,
      command: 'node',
      args: ['--test', ...scriptTests],
      noTests: nodeTestNoTests,
      reason: 'changed scripts, their tests or the tests that import them',
    });
  if (staticOnly) {
    if (frontendTests.length)
      // Vitest filters match by path substring; frontend paths are relative to its project root.
      steps.push({
        label: `test: ${frontendTests.length} frontend test file(s)`,
        args: [
          '--dir',
          'apps/frontend',
          'exec',
          'vitest',
          'run',
          ...frontendTests.map((path) => path.replace(/^apps\/frontend\//, '')),
        ],
        reason: 'changed test files',
      });
    if (frontendSuite)
      steps.push({ label: 'test: frontend suite', skip: '--static; the full check runs it' });
    else if (related.some((path) => !frontendTest.test(path)))
      steps.push({
        label: 'test: frontend tests related to changes',
        skip: '--static; the full check runs them',
      });
  } else if (frontendSuite)
    steps.push({
      label: 'test: frontend suite',
      args: ['--dir', 'apps/frontend', 'exec', 'vitest', 'run'],
      reason:
        'frontend configuration, shared package metadata, dependencies or a deleted source file changed',
    });
  else if (related.length)
    // A changed file with no dependent tests is a legitimate result, unlike a filter that matches nothing.
    steps.push({
      label: `test: frontend tests related to ${related.length} file(s)`,
      reason: 'changed frontend or shared source',
      args: [
        '--dir',
        'apps/frontend',
        'exec',
        'vitest',
        'related',
        '--run',
        '--passWithNoTests',
        ...related.map((path) => `../../${path}`),
      ],
    });
  if (runsBackendSuite)
    steps.push({
      label: 'test: backend suite',
      args: ['--dir', 'apps/backend', 'test'],
      reason: summarise(suiteReasons),
    });
  else if (backendSpecs.length)
    steps.push({
      label: `test: ${backendSpecs.length} backend spec file(s)`,
      args: [
        '--dir',
        'apps/backend',
        'test',
        ...backendSpecs.flatMap((path) => ['--files', relativeTo('apps/backend/')(path)]),
      ],
      noTests: japaNoTests,
      reason: summarise(
        backendSpecs.map((spec) => `${relativeTo(backendTests)(spec)}: ${specReasons.get(spec)}`),
      ),
    });
  if (backendSuite && staticOnly)
    steps.push({ label: 'test: backend suite', skip: '--static; the full check runs it' });
  else if (staticOnly && mappedSpecs.size)
    steps.push({
      label: 'test: backend specs importing changes',
      skip: '--static; the full check runs them',
    });

  if (paths.some((path) => path.startsWith('docs-src/') || path === docsSiteTest))
    steps.push(
      {
        label: 'docs: build the documentation site',
        args: ['run', 'docs:build'],
        owner: 'docs',
        reason: 'documentation sources or the built-site test changed',
      },
      {
        label: 'docs: check the built site',
        args: ['run', 'docs:test'],
        owner: 'docs',
        reason: 'documentation sources or the built-site test changed',
      },
    );
  if (paths.some((path) => path.startsWith('e2e/')))
    steps.push({ label: 'e2e', skip: 'end-to-end specs run with pnpm run e2e' });
  return steps;
}

/**
 * Select the browser work for a change: `none`, the changed spec files on their own, or the
 * whole `pnpm run e2e` suite (Chromium and auth projects).
 *
 * A fixture, helper or Playwright configuration change can affect every spec, so it selects the
 * whole suite. Firefox and WebKit run in scheduled, release and manual validation.
 */
export function selectE2eSpecs(
  paths,
  exists = (path) => existsSync(new URL(path, pathToFileURL(root))),
) {
  const inputs = paths.filter((path) => e2eInput.test(path));
  if (!inputs.length) return { run: 'none', specs: [], reason: 'no end-to-end changes' };
  const support = inputs.filter((path) => !e2eSpec.test(path));
  if (support.length)
    return {
      run: 'suite',
      specs: [],
      reason: `${support.length} end-to-end support file(s) changed, such as ${support[0]}; running the Chromium and auth suites`,
    };
  const specs = inputs.filter(exists);
  return specs.length
    ? { run: 'specs', specs, reason: `${specs.length} changed spec file(s)` }
    : { run: 'none', specs: [], reason: 'only deleted spec files' };
}

const commandLine = (step) => [step.command === 'node' ? 'node' : 'pnpm', ...step.args].join(' ');

/** Report whether a test step's output shows that it executed no tests. */
export function ranNoTests(step, output) {
  return step.noTests ? step.noTests.test(output) : false;
}

/** Read how many tests a passing test step ran, so a pass shows what it covered. */
export function testCount(output) {
  for (const pattern of testCounts) {
    const match = pattern.exec(output);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function passDetail(step, output) {
  if (!step.label.startsWith('test:')) return '';
  const count = testCount(output);
  return count === undefined ? ' (no test count reported)' : ` (${count} tests)`;
}

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * List the paths changed since the merge-base with `base`, uncommitted and untracked ones included.
 *
 * A rename is listed as both paths, so tests that still import the old one are selected.
 */
export function changedPaths(base, cwd = root) {
  const mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
  const tracked = git(['diff', '--name-only', '--no-renames', mergeBase], cwd);
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))].sort();
}

function stopGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // The group may already have exited between the timeout firing and the signal.
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Run one planned step, stopping its whole process group if it outlives `limits.timeoutMs`. */
export async function runStep(step, limits = stepLimits) {
  // Loaded here so the selection modes run before dependencies are installed.
  const { nonColourEnvironment, spawnPnpm } = await import('../shared/pnpmSpawn.mjs');
  return new Promise((resolve) => {
    const options = {
      cwd: root,
      env: { ...nonColourEnvironment(), ...step.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    };
    const child =
      step.command === 'node'
        ? spawn(process.execPath, step.args, options)
        : spawnPnpm(step.args, options);
    const chunks = [];
    let timedOut = false;
    let killTimer;
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => stopGroup(child, 'SIGKILL'), limits.killGraceMs);
    }, limits.timeoutMs);
    const stopTimers = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
    };
    child.on('error', (error) => {
      stopTimers();
      resolve({ passed: false, output: `could not start: ${error.message}` });
    });
    child.on('close', (status) => {
      stopTimers();
      const output = Buffer.concat(chunks).toString('utf8');
      if (timedOut)
        resolve({
          passed: false,
          output: `${output}\nstopped after ${limits.timeoutMs / 1000} seconds`,
        });
      else if (status !== 0) resolve({ passed: false, output });
      else if (ranNoTests(step, output))
        resolve({ passed: false, output: `${output}\nno tests were executed` });
      else resolve({ passed: true, output });
    });
  });
}

const modes = [
  '--plan',
  '--static',
  '--tests-only',
  '--push',
  '--static-scope',
  '--tooling-scope',
  '--e2e-plan',
];

/** Append a Markdown table of the planned checks to the GitHub Actions job summary, when present. */
function writeSummary(heading, rows) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const cell = (text) => String(text ?? '').replaceAll('|', '\\|');
  const table = rows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n');
  appendFileSync(
    file,
    `### ${heading}\n\n| Check | Result | Reason |\n| --- | --- | --- |\n${table}\n\n`,
  );
}

/** Select and report checks for the command-line arguments, executing them only in run modes. */
export async function main(args, pathsSince = changedPaths, execute = runStep) {
  try {
    assertSupportedNodeVersion();
    const chosen = modes.filter((mode) => args.includes(mode));
    const [base = defaultBase, ...extra] = args.filter((arg) => !modes.includes(arg));
    if (extra.length || base.startsWith('-') || chosen.length > 1)
      throw new Error(`Expected at most one of ${modes.join(', ')}, and at most one base ref.`);
    const [mode] = chosen;
    const paths = pathsSince(base);
    if (mode === '--static-scope') {
      // Standard output carries only the scope, so a workflow can branch on it.
      const { scope, reason } = staticScope(paths);
      console.error(`check:changed --static-scope: ${scope}, ${reason} since ${base}`);
      writeSummary('Static analysis', [
        [scope === 'full' ? 'format, lint and type-check' : 'format', 'selected', reason],
      ]);
      console.log(scope);
      return;
    }
    if (mode === '--tooling-scope') {
      const { scope, reason } = toolingScope(paths);
      console.error(`check:changed --tooling-scope: ${scope}, ${reason} since ${base}`);
      writeSummary('Tooling checks', [
        ['tooling policy', scope === 'run' ? 'selected' : 'skipped', reason],
      ]);
      console.log(scope);
      return;
    }
    if (mode === '--e2e-plan') {
      // Standard output carries only the JSON plan, so a workflow can read it with fromJSON.
      const plan = selectE2eSpecs(paths);
      console.error(`check:changed --e2e-plan: ${plan.reason} since ${base}`);
      writeSummary('Browser tests', [
        [plan.run === 'specs' ? plan.specs.join(', ') : plan.run, 'selected', plan.reason],
      ]);
      console.log(JSON.stringify(plan));
      return;
    }
    if (!paths.length) {
      console.log(`No changes since ${base}.`);
      writeSummary('Changed checks', [['none', 'skipped', `no changes since ${base}`]]);
      return;
    }
    console.log(`check:changed: ${paths.length} changed path(s) since ${base}`);
    let failed = false;
    const rows = [];
    const plan = planChecks(paths, undefined, undefined, {
      staticOnly: mode === '--static',
      testsOnly: mode === '--tests-only',
      pushOnly: mode === '--push',
    });
    for (const step of plan) {
      const why = step.reason ? `\n      why: ${step.reason}` : '';
      if (step.skip) {
        console.log(`skip  ${step.label} (${step.skip})${why}`);
        rows.push([step.label, 'skipped', step.skip]);
        continue;
      }
      if (mode === '--plan') {
        console.log(`plan  ${step.label}${why}\n      $ ${commandLine(step)}`);
        rows.push([step.label, 'selected', step.reason]);
        continue;
      }
      const result = await execute(step);
      // Name what each test step ran, so a log shows the selected files or suite.
      const command = step.label.startsWith('test:') ? `\n      $ ${commandLine(step)}` : '';
      if (result.passed) {
        const detail = passDetail(step, result.output);
        console.log(`pass  ${step.label}${detail}${why}${command}`);
        if (!step.prepare) rows.push([step.label, `passed${detail}`, step.reason]);
        continue;
      }
      console.log(`fail  ${step.label}${why}${command}`);
      rows.push([step.label, 'failed', step.reason]);
      failed = true;
      console.log(result.output.trimEnd().split('\n').slice(-logTailLines).join('\n'));
      if (step.prepare) break;
    }
    if (!plan.some((step) => !step.prepare && !step.skip))
      console.log('No checks selected; nothing to run.');
    writeSummary(
      'Changed checks',
      rows.length ? rows : [['none', 'skipped', 'no check selected for these paths']],
    );
    if (failed) process.exitCode = 1;
  } catch (error) {
    // Separate a broken invocation, such as an unknown base ref, from an ordinary failing check.
    console.error(`check:changed failed: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
