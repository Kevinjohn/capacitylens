import { test } from '@japa/runner';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../../bin/unsettled_start.ts', import.meta.url));

/** Runs an entry point whose start is the given promise expression, in its own process. */
function runEntry(start: string) {
  const source = `import { failUnsettledStart } from ${JSON.stringify(helper)};
void failUnsettledStart(${start}, 'The probe');`;
  return spawnSync(
    process.execPath,
    ['--import=@poppinss/ts-exec', '--input-type=module', '--eval', source],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' }
  );
}

test.group('unsettled start', () => {
  test('a start that never settles ends the process with exit 1 and says why', ({ assert }) => {
    const result = runEntry('new Promise(() => {})');
    assert.isNull(result.signal, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    assert.include(result.stderr, 'The probe stopped before the application started');
  });

  test('a start that settles keeps its own exit code', ({ assert }) => {
    const result = runEntry('Promise.resolve()');
    assert.isNull(result.signal, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.notInclude(result.stderr, 'stopped before the application started');
  });
});
