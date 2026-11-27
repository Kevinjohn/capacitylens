import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratchBackendFilter } from '#tests/helpers/operator_command_helpers'

/**
 * Copies the backend so a test can start `bin/test.ts` there with its own spec files. The entry
 * uses the `tmp/japa-<port>.db` beside itself, which in a copy is never the running suite's database.
 */
export function scratchEntry(root: string, files: Record<string, string>) {
  const app = join(root, 'apps/backend')
  cpSync(process.cwd(), app, { recursive: true, filter: scratchBackendFilter })
  symlinkSync(join(process.cwd(), 'node_modules'), join(app, 'node_modules'), 'dir')
  // The entry imports the port lane map from the repository's tooling folder.
  symlinkSync(join(process.cwd(), '../../tooling'), join(root, 'tooling'), 'dir')
  mkdirSync(join(app, 'tmp'))
  for (const [path, source] of Object.entries(files)) writeFileSync(join(app, path), source)
  return app
}

/** The arguments that start the suite entry `bin/test.ts`. */
export const testEntry = ['--import=@poppinss/ts-exec', 'bin/test.ts']

/** Runs the suite entry in a scratch backend and returns its exit status and output. */
export function runTestEntry(app: string, args: string[]) {
  const child = spawnSync(process.execPath, [...testEntry, ...args], {
    cwd: app,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` }
}

/** A spec whose test keeps querying the database after its time limit. */
export const lateWorkSpec = `import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';

test.group('late work', () => {
  test('queries the database after its time limit', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await db.rawQuery('select 1');
  }).timeout(200);
});
`

/** A spec whose first test waits for a termination signal. */
export const interruptedRunSpec = `import { test } from '@japa/runner';

test.group('interrupted run', () => {
  test('waits for the signal', async () => {
    process.stdout.write('first test started\\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }).timeout(30000);

  test('must not start', () => {
    process.stdout.write('second test started\\n');
  });
});
`

const unsettledStartModule = fileURLToPath(
  new URL('../../../bin/unsettled_start.ts', import.meta.url)
)

/** Runs an entry point whose start is the given promise expression, in its own process. */
export function runUnsettledEntry(start: string) {
  const source = `import { failUnsettledStart } from ${JSON.stringify(unsettledStartModule)};
void failUnsettledStart(${start}, 'The probe');`
  return spawnSync(
    process.execPath,
    ['--import=@poppinss/ts-exec', '--input-type=module', '--eval', source],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' }
  )
}
