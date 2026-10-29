import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const presetScript = fileURLToPath(new URL('./run-preset.mjs', import.meta.url));

for (const preset of ['constructor', 'toString', 'unknown']) {
  test(`refuses inherited or unknown preset ${preset} before spawning`, () => {
    const result = spawnSync(process.execPath, [presetScript, preset], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /run-preset: unknown preset/);
  });
}

test('supported presets preserve literal forwarded arguments and mode environments', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'capacitylens-preset-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'pnpm'),
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),demo:process.env.VITE_CAPACITYLENS_DEMO}));\n`,
    { mode: 0o755 },
  );
  for (const [preset, prefix] of [
    ['dev-demo', ['run', 'dev:web']],
    ['webkit', ['exec', 'playwright', 'test', '--project=webkit']],
    ['firefox', ['exec', 'playwright', 'test', '--project=firefox']],
  ]) {
    const result = spawnSync(process.execPath, [presetScript, preset, 'literal argument;$()'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.args, [...prefix, 'literal argument;$()']);
    if (preset === 'dev-demo') assert.equal(output.demo, '1');
  }
});

test('preset tests run from a checkout path containing spaces and a hash', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'capacitylens preset #'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of [
    'run-preset.test.mjs',
    'run-preset.mjs',
    'pnpmSpawn.mjs',
    'playwrightRunMode.mjs',
  ]) {
    await writeFile(join(directory, file), await readFile(new URL(file, import.meta.url)));
  }
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(directory, 'node_modules'),
    'dir',
  );
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-name-pattern=refuses inherited|supported presets',
      join(directory, 'run-preset.test.mjs'),
    ],
    { encoding: 'utf8', env: environment },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 4\b/);
});
