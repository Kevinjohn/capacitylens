import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PORT_LANE_CEILING, portsForPortLane, resolvePortLane } from '@capacitylens/tooling/ports'

const PROBE_ENVIRONMENT_KEY = 'CAPACITYLENS_TEST_ENTRY_EXIT_PROBE'

test.group('test entry exit', () => {
  test('a failed test that holds the pooled connection still ends the run with a summary and exit 1', ({
    assert,
    test: t,
  }) => {
    t.timeout(40000)
    // The test entry derives its database from the port lane, so the child runs on the next port
    // lane and this run's own database is untouched.
    const portLane = (resolvePortLane() + 1) % PORT_LANE_CEILING
    const database = join(process.cwd(), 'tmp', `japa-${portsForPortLane(portLane).testHttp}.db`)
    const kept = `${database}.kept`
    const hadDatabase = existsSync(database)
    const probeName = `zz_entry_exit_probe_${process.pid}`
    const probe = join(process.cwd(), 'tests', 'unit', `${probeName}.spec.ts`)
    // The probe only fails inside the child, so a copy left behind cannot fail an ordinary run.
    writeFileSync(
      probe,
      `import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
test('probe holds the pooled connection and fails', async () => {
  if (!process.env.${PROBE_ENVIRONMENT_KEY}) return;
  await db.transaction();
  throw new Error('probe failure');
});
`
    )
    if (hadDatabase) renameSync(database, kept)
    try {
      const result = spawnSync(
        process.execPath,
        ['--import=@poppinss/ts-exec', 'bin/test.ts', '--files', probeName],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 30000,
          // SIGKILL, so the result shows a signal whenever the entry had to be stopped.
          killSignal: 'SIGKILL',
          env: {
            ...process.env,
            CAPACITYLENS_PORT_LANE: String(portLane),
            [PROBE_ENVIRONMENT_KEY]: '1',
          },
        }
      )
      const output = `${result.stdout}\n${result.stderr}`
      assert.isNull(result.signal, `the test entry hung: ${output}`)
      assert.equal(result.status, 1, output)
      assert.match(output, /Tests\s+1 failed \(1\)/)
    } finally {
      rmSync(probe, { force: true })
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${database}${suffix}`, { force: true })
      if (hadDatabase) renameSync(kept, database)
    }
  })
})
