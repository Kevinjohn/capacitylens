// Check only what this branch changed, before the full gate:
//
//   pnpm run check:changed           changes since the merge-base with origin/platform/adonisjs
//   pnpm run check:changed <base>    changes since the merge-base with <base>
//   pnpm run check:changed --static  the same, without dependency lookups or whole test suites
//
// Uncommitted and untracked files count as changed. `pnpm run gate:all` and `pnpm run e2e` remain
// the submission gate; this is the fast loop while implementing or reviewing a change.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSupportedNodeVersion } from '../apps/backend/start/node_version.ts';
import { nonColourEnvironment, spawnPnpm } from './pnpmSpawn.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultBase = 'origin/platform/adonisjs';
// Japa keeps its process alive after a planner error, so a step that never exits must still fail.
// The backend test runner turns SIGTERM into a graceful shutdown that can hang too, hence SIGKILL.
const stepLimits = { timeoutMs: 20 * 60_000, killGraceMs: 10_000 };
const logTailLines = 40;

const codeFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const typeInput = /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$/;
const backendSpec = /^apps\/backend\/tests\/.+\.spec\.ts$/;
const frontendTest =
  /^(?:apps\/frontend\/src\/.+\.(?:test|spec)\.tsx?|packages\/shared\/.+\.(?:test|spec)\.ts)$/;
// Backend static file tests read the built application, which a fresh worktree lacks.
const appBuildOutput = 'apps/backend/public/assets';
// CI builds the application before backend tests with these fixed, non-secret values
// (.github/workflows/gate.yml).
const appBuildEnvironment = {
  NODE_ENV: 'production',
  CAPACITYLENS_SECRET: 'capacitylens-build-secret-0123456789abcdef',
  CAPACITYLENS_PUBLIC_URL: 'https://127.0.0.1',
  HOST: '127.0.0.1',
  PORT: '0',
  LOG_LEVEL: 'error',
  APP_KEY: 'capacitylens-test-key-0123456789abcdef',
  APP_URL: 'http://127.0.0.1',
  SESSION_DRIVER: 'memory',
};
// A rule or ignore change can fail files the branch never touched.
const lintConfig = /(?:^|\/)eslint\.config\.[cm]?js$/;
const formatConfig = /^\.prettier(?:rc[^/]*|ignore)$/;
// Dependency and workspace changes can break any package without touching its sources.
const workspaceInput = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/;
// A filter that matches nothing reports success; these markers turn it into a failure.
const japaNoTests = /NO TESTS EXECUTED/;
const nodeTestNoTests = /^(?:# |ℹ )tests 0$/m;
// Vitest and Japa summarise as "Tests  12 passed (12)"; node --test reports "tests 12".
const testCounts = [/^\s*Tests\s+(\d+) passed/m, /^(?:# |ℹ )tests (\d+)$/m];

const relativeTo = (prefix) => (path) => path.slice(prefix.length);

/** List the script test files that import `scripts/<name>.mjs`, whatever they are called. */
function scriptTestsImporting(path) {
  const scripts = new URL('scripts/', pathToFileURL(root));
  const specifier = `./${path.slice('scripts/'.length)}"`;
  return readdirSync(scripts)
    .filter(
      (name) =>
        name.endsWith('.test.mjs') &&
        readFileSync(new URL(name, scripts), 'utf8').includes(specifier),
    )
    .map((name) => `scripts/${name}`);
}

/**
 * Plan the checks for a branch's changed paths, in run order.
 *
 * Deleted paths still select suites and the type-check, but are never passed to a tool that
 * expects existing files. With `staticOnly`, changed test files run on their own and every
 * dependency lookup or whole suite becomes a skip line, for changes that share one full run.
 */
export function planChecks(
  paths,
  exists = (path) => existsSync(new URL(path, pathToFileURL(root))),
  testsImporting = scriptTestsImporting,
  { staticOnly = false } = {},
) {
  const present = paths.filter(exists);
  const presentCode = present.filter((path) => codeFile.test(path));
  const backendPaths = paths.filter((path) => path.startsWith('apps/backend/'));
  const sharedChanged = paths.some((path) => path.startsWith('packages/shared/'));
  const sharedMetadataChanged = paths.some(
    (path) => path.startsWith('packages/shared/') && typeInput.test(path),
  );
  const workspaceChanged = paths.some((path) => workspaceInput.test(path));
  const backendSuite =
    sharedChanged || workspaceChanged || backendPaths.some((path) => !backendSpec.test(path));
  const backendSpecs =
    backendSuite && !staticOnly ? [] : present.filter((path) => backendSpec.test(path));
  const frontendTests = present.filter((path) => frontendTest.test(path));
  const frontendLint = presentCode.filter((path) => path.startsWith('apps/frontend/'));
  const rootLint = presentCode.filter((path) =>
    /^(?:scripts|e2e|packages\/shared\/src)\//.test(path),
  );
  const backendLint = presentCode.filter((path) => path.startsWith('apps/backend/'));
  const related = presentCode.filter((path) =>
    /^(?:apps\/frontend\/src|packages\/shared\/src)\//.test(path),
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
  const scriptTests = [
    ...new Set(
      paths
        .filter((path) => /^scripts\/[^/]+\.mjs$/.test(path))
        .flatMap((path) =>
          path.endsWith('.test.mjs')
            ? [path]
            : [path.replace(/\.mjs$/, '.test.mjs'), ...testsImporting(path)],
        )
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
  if ((runsBackendSuite || backendSpecs.length) && !exists(appBuildOutput))
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
    });
    // Type-aware frontend lint reads backend route types through a project reference whose output
    // lives under apps/backend/node_modules: a reinstall deletes it and another commit leaves it stale.
    steps.push({
      label: 'prepare: build backend client types',
      args: ['--dir', 'apps/backend', 'typecheck:client'],
      prepare: true,
    });
  }

  const fullLint = paths.some((path) => lintConfig.test(path));
  if (paths.some((path) => formatConfig.test(path)))
    steps.push({ label: 'format: whole repository', args: ['run', 'format:check'] });
  else if (present.length)
    steps.push({
      label: `format: ${present.length} file(s)`,
      args: [
        'exec',
        'prettier',
        '--check',
        '--ignore-unknown',
        '--no-error-on-unmatched-pattern',
        ...present,
      ],
    });
  // Each package's own lint script decides whether warnings fail: the backend's allows them.
  const eslint = ['exec', 'eslint', '--no-warn-ignored'];
  const strictEslint = [...eslint, '--max-warnings', '0'];
  if (fullLint) steps.push({ label: 'lint: whole repository', args: ['run', 'lint'] });
  if (!fullLint && backendLint.length)
    steps.push({
      label: `lint: backend ${backendLint.length} file(s)`,
      args: ['--dir', 'apps/backend', ...eslint, ...backendLint.map(relativeTo('apps/backend/'))],
    });
  if (!fullLint && frontendLint.length)
    steps.push({
      label: `lint: frontend ${frontendLint.length} file(s)`,
      args: [
        '--dir',
        'apps/frontend',
        ...strictEslint,
        ...frontendLint.map(relativeTo('apps/frontend/')),
      ],
    });
  if (!fullLint && rootLint.length)
    steps.push({ label: `lint: ${rootLint.length} file(s)`, args: [...strictEslint, ...rootLint] });
  if (workspaceChanged || paths.some((path) => codeFile.test(path) || typeInput.test(path)))
    steps.push({ label: 'typecheck', args: ['run', 'typecheck'] });

  if (scriptTests.length)
    steps.push({
      label: `test: ${scriptTests.length} script test file(s)`,
      command: 'node',
      args: ['--test', ...scriptTests],
      noTests: nodeTestNoTests,
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
    });
  else if (related.length)
    // A changed file with no dependent tests is a legitimate result, unlike a filter that matches nothing.
    steps.push({
      label: `test: frontend tests related to ${related.length} file(s)`,
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
    steps.push({ label: 'test: backend suite', args: ['--dir', 'apps/backend', 'test'] });
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
    });
  if (backendSuite && staticOnly)
    steps.push({ label: 'test: backend suite', skip: '--static; the full check runs it' });

  if (paths.some((path) => path.startsWith('docs-src/')))
    steps.push({
      label: 'docs: build and compare docs/',
      args: ['run', 'docs:build'],
      docsClean: true,
    });
  if (paths.some((path) => path.startsWith('e2e/')))
    steps.push({ label: 'e2e', skip: 'end-to-end specs run with pnpm run e2e' });
  return steps;
}

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
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    // The group may already have exited between the timeout firing and the signal.
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Run one planned step, stopping its whole process group if it outlives `limits.timeoutMs`. */
export function runStep(step, limits = stepLimits) {
  return new Promise((resolve) => {
    const options = {
      cwd: root,
      env: { ...nonColourEnvironment(), ...step.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
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
      else if (step.docsClean && git(['status', '--porcelain', '--', 'docs']).trim())
        resolve({
          passed: false,
          output: `${output}\ndocs/ differs from its sources; commit the rebuilt output`,
        });
      else resolve({ passed: true, output });
    });
  });
}

async function main() {
  try {
    assertSupportedNodeVersion();
    const args = process.argv.slice(2);
    const staticOnly = args.includes('--static');
    const [base = defaultBase, ...extra] = args.filter((arg) => arg !== '--static');
    if (extra.length || base.startsWith('-'))
      throw new Error('Expected --static and at most one base ref.');
    const paths = changedPaths(base);
    if (!paths.length) {
      console.log(`No changes since ${base}.`);
      return;
    }
    console.log(`check:changed: ${paths.length} changed path(s) since ${base}`);
    let failed = false;
    for (const step of planChecks(paths, undefined, undefined, { staticOnly })) {
      if (step.skip) {
        console.log(`skip  ${step.label} (${step.skip})`);
        continue;
      }
      const result = await runStep(step);
      if (result.passed) {
        console.log(`pass  ${step.label}${passDetail(step, result.output)}`);
        continue;
      }
      console.log(`fail  ${step.label}`);
      failed = true;
      console.log(result.output.trimEnd().split('\n').slice(-logTailLines).join('\n'));
      if (step.prepare) break;
    }
    if (failed) process.exitCode = 1;
  } catch (error) {
    // Separate a broken invocation, such as an unknown base ref, from an ordinary failing check.
    console.error(`check:changed failed: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
