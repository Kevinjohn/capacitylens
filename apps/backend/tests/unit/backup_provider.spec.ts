import { test } from '@japa/runner'
import type { ApplicationService } from '@adonisjs/core/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BackupProvider, { backupService } from '#providers/backup_provider'
import { openNativeDatabase } from '#services/backup/native'

test('the web provider starts daily backups and drains the real scheduler on shutdown', async ({
  assert,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-provider-'))
  const dbPath = join(root, 'source.db')
  const database = openNativeDatabase(dbPath)
  database.prepare('CREATE TABLE entries (id INTEGER PRIMARY KEY)').run()
  database.close()
  const app = {
    getEnvironment: () => 'web',
    config: {
      get: (key: string) =>
        key === 'backup.settings'
          ? { dir: join(root, 'backups'), keep: 2 }
          : {
              connection: 'sqlite',
              connections: {
                sqlite: { client: 'better-sqlite3', connection: { filename: dbPath } },
              },
            },
    },
  } as unknown as ApplicationService
  const provider = new BackupProvider(app)
  try {
    await provider.ready()
    const active = backupService!
    await provider.ready()
    assert.isTrue(backupService === active)
    const snapshot = active.snapshotNow()
    await provider.shutdown()
    assert.isString(await snapshot)
    assert.isNull(backupService)
    await assert.rejects(() => active.snapshotNow(), /stopped/)
  } finally {
    await provider.shutdown()
    rmSync(root, { recursive: true, force: true })
  }
})
