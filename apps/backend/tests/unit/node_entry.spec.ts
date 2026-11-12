import { supportsNodeVersion } from '#start/node_version';
import { test } from '@japa/runner';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operatorFixture, withOperatorServer } from './operator_command_support.js';

test('native web and Ace entries refuse unsupported Node before creating a database', ({
  assert,
  test: t,
}) => {
  t.timeout(40000);
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-node-entry-'));
  try {
    const preload = join(root, 'version.cjs');
    writeFileSync(preload, "Object.defineProperty(process.versions, 'node', { value: '24.18.0' })");
    for (const args of [
      ['ace.js', 'app:upgrade'],
      ['--import=@poppinss/ts-exec', 'bin/server.ts'],
    ]) {
      const database = join(root, `${args.length}.db`);
      const result = spawnSync(process.execPath, ['--require', preload, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, CAPACITYLENS_DB: database },
      });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /requires Node >=24.19.0 <25 or >=26.9.0 <27/
      );
      assert.isFalse(existsSync(database));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native server runtime versions preserve the released acceptance boundary', ({ assert }) => {
  for (const version of ['24.19.0', '24.21.0', '26.9.0', '26.11.1'])
    assert.isTrue(supportsNodeVersion(version), version);
  for (const version of ['22.0.0', '24.18.9', '25.0.0', '26.8.9', '27.0.0', '24.19', 'v24.19.0'])
    assert.isFalse(supportsNodeVersion(version), version);
});

test('native web entry reports an invalid environment through the framework printer', ({
  assert,
  test: t,
}) => {
  t.timeout(40000);
  const environment = { ...process.env };
  // An empty value overrides a local .env file; deleting the key would let that file supply it.
  environment.APP_KEY = '';
  const result = spawnSync(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15000,
    env: environment,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /Missing environment variable "APP_KEY"/);
  // An error thrown outside the Ignitor chain reaches Node's own uncaught-exception dump instead.
  assert.notMatch(output, /Node\.js v\d/);
});

test('native web entry loads the isolated-worker harness only when reset is enabled', async ({
  assert,
  test: t,
}) => {
  // `timeout` only sets the option for a test that has not started; an awaiting test must reset the live timer.
  t.resetTimeout(60000);
  const f = operatorFixture();
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    const preload = join(f.root, 'trace-harness.mjs');
    writeFileSync(
      preload,
      `import { registerHooks } from 'node:module';
registerHooks({
  load(url, context, nextLoad) {
    if (url.includes('/start/e2e_')) process.stderr.write('harness-loaded\\n');
    return nextLoad(url, context);
  },
});`
    );
    for (const [allowReset, loaded] of [
      ['false', false],
      ['true', true],
    ] as const) {
      const stderr = await withOperatorServer(f, async () => {}, {
        nodeArgs: [`--import=${preload}`],
        environment: { CAPACITYLENS_ALLOW_RESET: allowReset },
      });
      assert.equal(stderr.includes('harness-loaded'), loaded, `reset=${allowReset}: ${stderr}`);
    }
  } finally {
    f.cleanup();
  }
});
