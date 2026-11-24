import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { nonColourEnvironment, reportSpawnFailureAndResolveExitStatus } from './childProcess.mjs';

const runPreset = fileURLToPath(new URL('../e2e/run-preset.mjs', import.meta.url));

// Writes a stub pnpm launcher into a fresh directory; `body` is the Node module it runs.
function stubPnpm(prefix, body) {
  const fixture = mkdtempSync(join(tmpdir(), prefix));
  const launcher = join(fixture, 'pnpm');
  const capture = join(fixture, 'capture.mjs');
  writeFileSync(capture, body);
  writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(capture)};\n`);
  chmodSync(launcher, 0o700);
  return {
    env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}` },
    remove: () => rmSync(fixture, { recursive: true, force: true }),
  };
}

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
