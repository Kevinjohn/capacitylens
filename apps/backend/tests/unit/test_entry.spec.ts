import { test } from '@japa/runner';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { operatorFixture, scratchBackendFilter } from '#tests/helpers/operator_command_helpers';

/**
 * Copies the backend so a test can start `bin/test.ts` there with its own spec files. The entry
 * uses the `tmp/japa-<port>.db` beside itself, which in a copy is never the running suite's database.
 */
function scratchEntry(root: string, files: Record<string, string>) {
  const app = join(root, 'apps/backend');
  cpSync(process.cwd(), app, { recursive: true, filter: scratchBackendFilter });
  symlinkSync(join(process.cwd(), 'node_modules'), join(app, 'node_modules'), 'dir');
  // The entry imports the port lane map from the repository's tooling folder.
  symlinkSync(join(process.cwd(), '../../tooling'), join(root, 'tooling'), 'dir');
  mkdirSync(join(app, 'tmp'));
  for (const [path, source] of Object.entries(files)) writeFileSync(join(app, path), source);
  return app;
}

const entry = ['--import=@poppinss/ts-exec', 'bin/test.ts'];

function runEntry(app: string, args: string[]) {
  const child = spawnSync(process.execPath, [...entry, ...args], {
    cwd: app,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` };
}

const lateWorkSpec = `import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';

test.group('late work', () => {
  test('queries the database after its time limit', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await db.rawQuery('select 1');
  }).timeout(200);
});
`;

const interruptedRunSpec = `import { test } from '@japa/runner';

test.group('interrupted run', () => {
  test('waits for the signal', async () => {
    process.stdout.write('first test started\\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }).timeout(30000);

  test('must not start', () => {
    process.stdout.write('second test started\\n');
  });
});
`;

test.group('test entry', () => {
  test('work that outlives its test cannot keep the run alive after the summary', ({
    assert,
    test: t,
  }) => {
    t.timeout(120_000);
    const f = operatorFixture();
    try {
      const app = scratchEntry(f.root, { 'tests/unit/late_work.spec.ts': lateWorkSpec });

      const run = runEntry(app, ['--files', 'tests/unit/late_work.spec.ts']);

      assert.equal(run.status, 1, run.output);
      assert.match(run.output, /Tests\s+1 failed/);
    } finally {
      f.cleanup();
    }
  });

  test('a termination signal ends the run before the next test starts', async ({ assert }) => {
    const f = operatorFixture();
    try {
      const app = scratchEntry(f.root, {
        'tests/unit/interrupted_run.spec.ts': interruptedRunSpec,
      });
      const child = spawn(
        process.execPath,
        [...entry, '--files', 'tests/unit/interrupted_run.spec.ts'],
        { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let output = '';
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8').on('data', (chunk: string) => {
          output += chunk;
          if (output.includes('first test started')) child.kill('SIGTERM');
        });
      }
      const unresponsive = setTimeout(() => child.kill('SIGKILL'), 60_000);
      try {
        // A run that outlives the signal still ends: its first test waits five seconds.
        const [, signal] = await once(child, 'exit');
        assert.equal(signal, 'SIGTERM', output);
        assert.notInclude(output, 'second test started');
      } finally {
        clearTimeout(unresponsive);
      }
    } finally {
      f.cleanup();
    }
  }).timeout(120_000);
});
