import { test } from '@japa/runner'
import { join } from 'node:path'
import { listBundles } from '@kevinjohn/adonisjs-sqlite-backup'
import {
  insertOwner,
  operatorFixture,
  withOperatorServer,
} from '#tests/helpers/operator_command_helpers'
import { companyNames } from '#tests/helpers/unit/operator_databases'

test.group('backup restore', () => {
  // The documented procedure in docs-src/self-hosting/backups-and-restore.md: stage a bundle into a
  // new path, upgrade the staged copy, start the service on it and find the company again.
  test('a staged bundle upgrades, starts and still holds the company it was taken with', async ({
    assert,
    cleanup,
  }) => {
    const fixture = operatorFixture()
    cleanup(() => fixture.cleanup())
    const succeed = (args: string[], overrides: Record<string, string> = {}) => {
      const result = fixture.command(args, overrides)
      assert.equal(result.status, 0, result.output)
    }

    succeed(['app:upgrade'])
    const live = fixture.inspect()
    insertOwner(live)
    const directory = join(fixture.root, 'backups')
    succeed(['db:backup', 'create'], { CAPACITYLENS_BACKUP_DIR: directory })
    const [bundle] = listBundles(directory)
    live.prepare('DELETE FROM memberships').run()
    live.prepare('DELETE FROM companies').run()
    live.close()

    const staged = join(fixture.root, 'restored.db')
    succeed([
      'db:backup',
      'restore-prepare',
      '--directory',
      directory,
      '--bundle',
      bundle!.name,
      '--target',
      staged,
    ])
    assert.deepEqual(companyNames(fixture.databasePath), [])
    succeed(['app:upgrade'], { CAPACITYLENS_DB: staged })
    await withOperatorServer(fixture, async () => {}, {
      environment: { CAPACITYLENS_DB: staged },
    })
    assert.deepEqual(companyNames(staged), ['Wayne Enterprises'])
  }).timeout(90_000)
})
