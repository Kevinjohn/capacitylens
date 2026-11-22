import { test } from '@japa/runner';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { operatorFixture } from '#tests/helpers/operator_command_helpers';

test('the operator fixture separates machine stdout from warning stderr and preserves failures', ({
  assert,
  test: t,
}) => {
  t.timeout(10000);
  const fixture = operatorFixture();
  try {
    writeFileSync(
      join(fixture.root, 'ace.js'),
      `process.stdout.write(process.argv[2] === 'malformed' ? '{"ok":' : '{"ok":true}\\n');
process.emitWarning('fixture warning', { code: 'STREAM_FIXTURE' });
process.exitCode = process.argv[2] === 'nonzero' ? 7 : 0;
`
    );
    const command = (args: string[]) => fixture.command(args, {}, fixture.root);

    const success = command([]);
    assert.equal(success.status, 0, success.output);
    assert.equal(success.stdout, '{"ok":true}\n');
    assert.match(success.stderr, /\[STREAM_FIXTURE\] Warning: fixture warning/);
    assert.equal(success.output, `${success.stdout}\n${success.stderr}`);
    assert.deepEqual(JSON.parse(success.stdout), { ok: true });
    assert.throws(() => JSON.parse(success.output), SyntaxError);

    const malformed = command(['malformed']);
    assert.equal(malformed.status, 0, malformed.output);
    assert.equal(malformed.stdout, '{"ok":');
    assert.throws(() => JSON.parse(malformed.stdout), SyntaxError);

    const failed = command(['nonzero']);
    assert.equal(failed.status, 7, failed.output);
    assert.equal(failed.stdout, '{"ok":true}\n');
    assert.equal(failed.output, `${failed.stdout}\n${failed.stderr}`);
    assert.throws(
      () => assert.equal(failed.status, 0, failed.output),
      /\[STREAM_FIXTURE\] Warning: fixture warning/
    );
  } finally {
    fixture.cleanup();
  }
});
