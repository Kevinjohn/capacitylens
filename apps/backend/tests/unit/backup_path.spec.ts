import { test } from '@japa/runner'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { openNativeDatabase } from '#services/backup/native'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'

test('snapshot accepts equivalent directory paths and refuses destinations outside the directory', async ({
  assert,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-backup-path-'))
  const dbPath = join(root, 'live.db')
  const absoluteDir = join(root, 'backups')
  const database = openNativeDatabase(dbPath)
  try {
    database.prepare('CREATE TABLE adonis_schema (id INTEGER PRIMARY KEY, name TEXT)').run()
    ensurePrivateBackupDirectory(absoluteDir)
    const trailingDir = `${absoluteDir}/`
    const trailingFile = join(trailingDir, 'trailing.db')
    await writeOneShotSnapshot({ database, dir: trailingDir, file: trailingFile })
    assert.isTrue(existsSync(trailingFile))

    const relativeDir = relative(process.cwd(), absoluteDir)
    const relativeFile = join(relativeDir, 'relative.db')
    await writeOneShotSnapshot({ database, dir: relativeDir, file: relativeFile })
    assert.isTrue(existsSync(relativeFile))

    await assert.rejects(
      () => writeOneShotSnapshot({ database, dir: absoluteDir, file: join(root, 'outside.db') }),
      /configured directory/
    )
    assert.isFalse(existsSync(join(root, 'outside.db')))
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
