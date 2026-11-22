import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  nonColourEnvironment,
  reportSpawnFailureAndResolveExitStatus,
  spawnPnpm,
  spawnPnpmSync,
} from './pnpmSpawn.mjs';

const runPreset = fileURLToPath(new URL('../e2e/run-preset.mjs', import.meta.url));

// Writes a stub pnpm launcher into a fresh directory; `body` is the Node module it runs on POSIX.
function stubPnpm(prefix, body) {
  const fixture = mkdtempSync(join(tmpdir(), prefix));
  const launcher = join(fixture, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  const capture = join(fixture, 'capture.mjs');
  writeFileSync(capture, body);
  if (process.platform === 'win32') {
    writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
  } else {
    writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(capture)};\n`);
    chmodSync(launcher, 0o700);
  }
  return {
    env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}` },
    remove: () => rmSync(fixture, { recursive: true, force: true }),
  };
}

const ECHO_ARGV = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n';

test('synchronous spawn results follow Node encoding-dependent types', async (context) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'capacitylens-spawn-types-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, 'fixture.mts');
  await writeFile(
    fixture,
    `import { spawnPnpmSync } from ${JSON.stringify(join(root, 'scripts/shared/pnpmSpawn.mjs'))};
import type { SpawnSyncOptions } from "node:child_process";
const binary: Buffer | null = spawnPnpmSync([]).stdout;
const binaryExplicit: Buffer | null = spawnPnpmSync([], {encoding: "buffer"}).stdout;
const text: string | null = spawnPnpmSync([], {encoding: "utf8"}).stdout;
const textError: string | null = spawnPnpmSync([], {encoding: "utf8"}).stderr;
const options: SpawnSyncOptions = {};
const either: Buffer | string | null = spawnPnpmSync([], options).stdout;
function run(options?: SpawnSyncOptions) { return spawnPnpmSync([], options); }
const optional: Buffer | string | null = run().stdout;
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      'node',
      '--typeRoots',
      join(root, 'node_modules/@types'),
      fixture,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('spawnPnpm preserves spaces and shell metacharacters as literal argument boundaries', async (context) => {
  const pnpm = stubPnpm('capacitylens-pnpm-argv-', ECHO_ARGV);
  context.after(pnpm.remove);
  const args = ['two words', 'quote"value', 'pipe|value', 'dollar$value', 'glob*value'];
  const child = spawnPnpm(args, { env: pnpm.env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = await new Promise((settle, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => settle({ code, signal }));
  });

  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.deepEqual(JSON.parse(stdout), args);
});

test('spawnPnpmSync preserves literal argument boundaries synchronously', (context) => {
  const pnpm = stubPnpm('capacitylens-pnpm-sync-', ECHO_ARGV);
  context.after(pnpm.remove);
  const args = ['exec', 'playwright', 'test', '--grep', 'foo(bar)', 'two words', 'glob*value'];
  const result = spawnPnpmSync(args, { env: pnpm.env, encoding: 'utf8' });
  assert.equal(result.status, 0, String(result.stderr));
  assert.deepEqual(JSON.parse(String(result.stdout)), args);
});

for (const [preset, expectedPrefix, expectedFlag] of [
  ['webkit', ['exec', 'playwright', 'test', '--project=webkit'], 'CAPACITYLENS_WEBKIT_ONLY'],
  ['firefox', ['exec', 'playwright', 'test', '--project=firefox'], 'CAPACITYLENS_FIREFOX_ONLY'],
]) {
  test(`the ${preset} package preset launches without a shell assignment`, (context) => {
    const pnpm = stubPnpm(
      'capacitylens-preset-',
      `process.stdout.write(JSON.stringify({argv:process.argv.slice(2),flag:process.env[${JSON.stringify(expectedFlag)}]}));\n`,
    );
    context.after(pnpm.remove);
    const result = spawnSync(
      process.execPath,
      [runPreset, preset, '--grep', 'foo(bar)', 'two words'],
      { env: pnpm.env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.argv, [...expectedPrefix, '--grep', 'foo(bar)', 'two words']);
    assert.equal(output.flag, '1');
  });
}

for (const [index, parent] of [
  {},
  { NO_COLOR: '1' },
  { FORCE_COLOR: '1' },
  { NO_COLOR: '1', FORCE_COLOR: '1' },
].entries()) {
  test(`nonColourEnvironment normalizes inherited colour controls for ${index}`, () => {
    const env = nonColourEnvironment({ RUN: 'yes' }, parent);
    assert.equal(Object.hasOwn(env, 'NO_COLOR'), false);
    assert.equal(env.FORCE_COLOR, '0');
    assert.equal(env.RUN, 'yes');
  });
}

test('reportSpawnFailureAndResolveExitStatus preserves ordinary test statuses', () => {
  assert.equal(
    reportSpawnFailureAndResolveExitStatus('phase', { status: 1 }, () => undefined),
    1,
  );
});

for (const [result, expectedMessage] of [
  [{ status: null, error: new Error('not found') }, /could not start.*not found/i],
  [{ status: null, signal: 'SIGTERM' }, /terminated by SIGTERM/i],
  [{ status: null }, /without an exit status/i],
]) {
  test(`reportSpawnFailureAndResolveExitStatus distinguishes runner failures from red tests (${expectedMessage})`, () => {
    const messages = [];
    assert.equal(
      reportSpawnFailureAndResolveExitStatus('browser phase', result, (message) =>
        messages.push(message),
      ),
      2,
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0], expectedMessage);
  });
}
