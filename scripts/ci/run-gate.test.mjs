import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gateCommands } from './gateCommands.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('./run-gate.mjs', import.meta.url));

function fixture(t, installCommand = true) {
  const directory = mkdtempSync(join(tmpdir(), 'ordered-gates-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'commands.jsonl');
  if (installCommand) {
    const command = join(directory, 'pnpm');
    const source = readFileSync(new URL('./fixtures/gate-command.mjs', import.meta.url), 'utf8');
    writeFileSync(`${command}.mjs`, source);
    writeFileSync(command, `#!${process.execPath}\n${source}`);
    chmodSync(command, 0o755);
  }
  return {
    log,
    run(args, extra = {}) {
      rmSync(log, { force: true });
      return spawnSync(process.execPath, [cli, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: installCommand ? `${directory}${delimiter}${process.env.PATH}` : directory,
          CAPACITYLENS_GATE_LOG: log,
          CAPACITYLENS_GATE_SENTINEL: 'preserved value',
          CAPACITYLENS_GATE_FAIL_COMMAND: '',
          CAPACITYLENS_GATE_SIGNAL: '',
          CAPACITYLENS_GATE_FAIL_CODE: '',
          ...extra,
        },
        encoding: 'utf8',
        timeout: 30_000,
      });
    },
    entries() {
      return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    },
  };
}

test('all gates execute their ordered commands once, from the repository, with inherited environment', (t) => {
  const stub = fixture(t);
  for (const gate of ['app', 'backend', 'all', 'tooling', 'static']) {
    const result = stub.run([gate]);
    assert.equal(result.status, 0, result.stderr);
    const entries = stub.entries();
    assert.deepEqual(
      entries.map(({ args }) => args),
      gateCommands(gate),
    );
    assert.ok(
      entries.every(
        ({ cwd, sentinel }) => cwd === root.replace(/[\\/]$/, '') && sentinel === 'preserved value',
      ),
    );
  }
});

test('a command failure keeps its exit code and prevents every later check', (t) => {
  const stub = fixture(t);
  for (const gate of ['app', 'backend', 'all']) {
    const commands = gateCommands(gate);
    const failing = commands.findIndex((args) => args.includes('policy:ports'));
    assert.ok(failing > 0);
    const result = stub.run([gate], {
      CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(commands[failing]),
      CAPACITYLENS_GATE_FAIL_CODE: '17',
    });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(
      stub.entries().map(({ args }) => args),
      commands.slice(0, failing + 1),
    );
  }
});

test('a terminated child is reported through the repository launcher policy and stops the gate', (t) => {
  const stub = fixture(t);
  const first = gateCommands('app')[0];
  const result = stub.run(['app'], {
    CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(first),
    CAPACITYLENS_GATE_SIGNAL: 'SIGTERM',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /terminated by SIGTERM/);
  assert.equal(stub.entries().length, 1);
});

test('a missing executable fails visibly before another command can run', (t) => {
  const stub = fixture(t, false);
  const result = stub.run(['backend']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not start/);
  assert.deepEqual(stub.entries(), []);
});

test('invalid modes and extra arguments fail before launching anything', (t) => {
  const stub = fixture(t);
  for (const args of [[], ['unknown'], ['constructor'], ['__proto__'], ['app', 'extra']]) {
    const result = stub.run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Expected app, backend, all, tooling or static/);
    assert.deepEqual(stub.entries(), []);
  }
});

test('all mode runs shared checks once before the app-only and server-only checks', () => {
  const app = gateCommands('app');
  const server = gateCommands('backend');
  const all = gateCommands('all');
  const key = (args) => JSON.stringify(args);
  const appKeys = new Set(app.map(key));
  const serverKeys = new Set(server.map(key));
  const sharedKeys = new Set(app.filter((args) => serverKeys.has(key(args))).map(key));
  const expectedKeys = new Set([...app, ...server].map(key));
  const actualKeys = all.map(key);
  const sharedPrefix = all.slice(0, sharedKeys.size);
  const lastAppOnly = all.findLastIndex(
    (args) => appKeys.has(key(args)) && !sharedKeys.has(key(args)),
  );
  const firstServerOnly = all.findIndex(
    (args) => serverKeys.has(key(args)) && !sharedKeys.has(key(args)),
  );

  assert.deepEqual(new Set(actualKeys), expectedKeys);
  assert.equal(new Set(actualKeys).size, actualKeys.length);
  assert.ok(sharedPrefix.every((args) => sharedKeys.has(key(args))));
  assert.ok(all.slice(sharedKeys.size).every((args) => !sharedKeys.has(key(args))));
  assert.deepEqual(
    sharedPrefix,
    server.filter((args) => sharedKeys.has(key(args))),
  );
  assert.deepEqual(
    all.filter((args) => appKeys.has(key(args)) && !sharedKeys.has(key(args))),
    app.filter((args) => !sharedKeys.has(key(args))),
  );
  assert.deepEqual(
    all.filter((args) => serverKeys.has(key(args)) && !sharedKeys.has(key(args))),
    server.filter((args) => !sharedKeys.has(key(args))),
  );
  assert.ok(lastAppOnly >= 0 && firstServerOnly >= 0 && lastAppOnly < firstServerOnly);
});

test("mode selection returns independent argument arrays and includes the runner's regressions", () => {
  const first = gateCommands('app');
  first[0].push('mutated');
  assert.ok(!gateCommands('app')[0].includes('mutated'));
  for (const mode of ['app', 'backend', 'all']) {
    assert.ok(gateCommands(mode).some((args) => args.includes('policy:gate-runner:test')));
  }
  assert.throws(() => gateCommands('unknown'), /Expected app, backend, all, tooling or static/);
});

test('the CI tooling and static jobs together run every app check except frontend tests and the build', () => {
  const key = (args) => JSON.stringify(args);
  const split = [...gateCommands('tooling'), ...gateCommands('static')].map(key);
  const app = gateCommands('app').map(key);
  assert.deepEqual(
    app.filter((entry) => !split.includes(entry)),
    [key(['--dir', 'apps/frontend', 'exec', 'vitest', 'run', '--coverage']), key(['run', 'build'])],
  );
  assert.ok(split.every((entry) => app.includes(entry)));
  for (const mode of ['tooling', 'static'])
    assert.ok(
      !gateCommands(mode).some((args) => args.includes('build') || args.includes('vitest')),
    );
});

test("gateCommands('all') excludes every retired custom structural check", () => {
  const names = gateCommands('all').map((args) => args.join(' '));
  for (const retired of [
    'policy:typed-lint:test',
    'policy:shared-environment:test',
    'policy:typecheck-graph:test',
    'policy:build-tsconfig:test',
    'policy:script-environments:test',
    'policy:import-cycles',
    'policy:dependencies:test',
    'security:crypto-inventory',
  ]) {
    assert.ok(!names.includes(`run ${retired}`), retired);
  }
});

test("gateCommands('all') includes every retained policy, package and security check", () => {
  const names = gateCommands('all').map((args) => args.join(' '));
  for (const retained of [
    'policy:gate-runner:test',
    'policy:ports',
    'policy:ports:test',
    'policy:e2e-workers:test',
    'policy:sonner-csp:test',
    'docker:release:test',
    'security:screenshot-publication',
    'security:screenshot-publication:test',
    'security:gitleaks-config',
    'policy:dco:test',
    'policy:release-validation:test',
    'policy:script-processes:test',
    'policy:node-runtime:test',
  ]) {
    assert.ok(names.includes(`run ${retained}`), retained);
  }
});

test('every scripts/ and tooling/ test file is named by a root package script', () => {
  const named = new Set(
    Object.values(
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts,
    )
      .join(' ')
      .split(/\s+/),
  );
  for (const folder of ['scripts', 'tooling']) {
    const testFiles = readdirSync(join(root, folder), { recursive: true })
      .map((path) => `${folder}/${String(path).replaceAll('\\', '/')}`)
      .filter((path) => /\.test\.[cm]?[jt]s$/.test(path));
    assert.ok(testFiles.length > 0, folder);
    for (const file of testFiles) assert.ok(named.has(file), `${file} is run by no script`);
  }
});

test('every gate runs the bundle check once, through the root build script', () => {
  const build = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    .scripts.build;
  assert.match(build, /&& pnpm run check:bundle$/);
  for (const mode of ['app', 'backend', 'all']) {
    const names = gateCommands(mode).map((args) => args.join(' '));
    assert.equal(names.filter((name) => name === 'run build').length, 1, mode);
    assert.ok(!names.includes('run check:bundle'), mode);
  }
});

test('backend and combined gates build application assets once before runtime checks and backend tests', () => {
  for (const mode of ['backend', 'all']) {
    const commands = gateCommands(mode);
    const builds = commands.flatMap((args, index) =>
      args[0] === 'run' && args[1] === 'build' ? [index] : [],
    );
    assert.equal(builds.length, 1);
    const runtime = commands.findIndex((args) => args.includes('policy:node-runtime:test'));
    const backendTests = commands.findIndex(
      (args) => args[0] === '--dir' && args[1] === 'apps/backend' && args[2] === 'test',
    );
    assert.ok(builds[0] < runtime && runtime < backendTests);
    if (mode === 'all') {
      const frontendTests = commands.findIndex((args) => args.includes('vitest'));
      assert.ok(builds[0] < frontendTests);
    }
  }
});

test('only the root production build receives production settings while tests retain their environment', (t) => {
  const stub = fixture(t);
  const result = stub.run(['app'], {
    NODE_ENV: 'test',
    CAPACITYLENS_PUBLIC_URL: 'https://inherited.example',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const entry of stub.entries()) {
    const build = entry.args[0] === 'run' && entry.args[1] === 'build';
    assert.equal(entry.nodeEnv, build ? 'production' : 'test', entry.args.join(' '));
    assert.equal(
      entry.publicUrl,
      build ? 'https://127.0.0.1' : 'https://inherited.example',
      entry.args.join(' '),
    );
  }
});

test('CI builds the application once and backend tests use those assets without production settings', async () => {
  const { parse } = await import('yaml');
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'),
  );
  const builds = Object.entries(workflow.jobs).filter(([, job]) =>
    job.steps.some((step) => step.run === 'pnpm run build'),
  );
  assert.deepEqual(
    builds.map(([name]) => name),
    ['build'],
  );
  const build = workflow.jobs.build.steps.find((step) => step.run === 'pnpm run build');
  assert.equal(build.env.NODE_ENV, 'production');
  assert.match(build.env.CAPACITYLENS_PUBLIC_URL, /^https:/);
  for (const key of ['APP_KEY', 'APP_URL', 'HOST', 'PORT', 'LOG_LEVEL'])
    assert.ok(build.env[key], key);
  const upload = workflow.jobs.build.steps.find((step) =>
    step.uses?.startsWith('actions/upload-artifact'),
  );
  assert.equal(upload.with.path, 'apps/backend/public/');

  const backend = workflow.jobs.backend;
  assert.ok(backend.needs.includes('build'));
  const download = backend.steps.findIndex((step) =>
    step.uses?.startsWith('actions/download-artifact'),
  );
  const testIndex = backend.steps.findIndex((step) => step.run === 'pnpm --dir apps/backend test');
  assert.equal(backend.steps[download].with.name, upload.with.name);
  assert.equal(backend.steps[download].with.path, upload.with.path);
  assert.ok(download >= 0 && download < testIndex);
  assert.notEqual(backend.env?.NODE_ENV, 'production');
  assert.notEqual(backend.steps[testIndex].env?.NODE_ENV, 'production');
});

test('main pushes cannot cancel scheduled or manual validation, and tooling selection survives cancelled runs', async () => {
  const { parse } = await import('yaml');
  const read = (name) =>
    parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
  for (const name of ['validation.yml', 'gate.yml', 'e2e.yml'])
    assert.match(read(name).concurrency.group, /\$\{\{ github\.event_name \}\}/, name);
  const select = read('gate.yml').jobs['tooling-scope'].steps.find((step) => step.id === 'select');
  assert.doesNotMatch(JSON.stringify(select), /event\.before/);
  assert.match(select.run, /validation\.yml\/runs\?branch=main&event=push&status=success/);
  assert.match(select.run, /merge-base --is-ancestor/);
  assert.equal(read('validation.yml').permissions.actions, 'read');
});
