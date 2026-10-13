import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseManifest } from '#database/released_manifest'
import { assertMigrationJournal, assertReleasedMigrationFiles } from '#services/released_migrations'
import releasedMigrationsHook from '../../hooks/released_migrations.js'
import { preMigrationBackupDirectory } from '../../commands/app_upgrade.js'
import { openNativeDatabase } from '#services/backup/native'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'
import type { Bundler } from '@adonisjs/assembler'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

test('released manifest rejects malformed or duplicate migration pins', ({ assert }) => {
  const first = { name: 'database/migrations/first', sha256: digest('first') }
  assert.deepEqual(parseManifest({ version: 1, migrations: [first] }), [first])
  assert.throws(() => parseManifest({ version: 1, migrations: [first, first] }), /Invalid/)
  assert.throws(
    () => parseManifest({ version: 1, migrations: [{ ...first, sha256: 'bad' }] }),
    /Invalid/
  )
  assert.throws(() => parseManifest({ version: 1, migrations: [], extra: true }), /Invalid/)
})

test('released journal accepts only a known prefix with valid batches', ({ assert }) => {
  const names = ['database/migrations/a', 'database/migrations/b']
  assert.doesNotThrow(() => assertMigrationJournal([{ name: names[0]!, batch: 1 }], names, true))
  assert.throws(() => assertMigrationJournal([{ name: names[0]!, batch: 1 }], names), /pending/)
  assert.throws(
    () => assertMigrationJournal([{ name: 'database/migrations/unknown', batch: 1 }], names, true),
    /inconsistent/
  )
  assert.throws(
    () => assertMigrationJournal([{ name: names[1]!, batch: 1 }], names, true),
    /inconsistent/
  )
  assert.throws(
    () =>
      assertMigrationJournal(
        [
          { name: names[0]!, batch: 2 },
          { name: names[1]!, batch: 1 },
        ],
        names,
        true
      ),
    /inconsistent/
  )
})

test('build hook rejects edited source and pins the compiled executable bytes', async ({
  assert,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'capacitylens-released-'))
  try {
    for (const prefix of ['', 'build/'])
      await mkdir(join(root, prefix, 'database/migrations'), { recursive: true })
    const name = 'database/migrations/first'
    await writeFile(join(root, `${name}.ts`), 'source')
    await writeFile(join(root, 'build', `${name}.js`), 'executable')
    await writeFile(
      join(root, 'database/released.json'),
      JSON.stringify({ version: 1, migrations: [{ name, sha256: digest('source') }] })
    )
    const bundler = { cwdPath: root } as Bundler
    await releasedMigrationsHook(bundler)
    const built = parseManifest(
      JSON.parse(await readFile(join(root, 'build/database/released.json'), 'utf8'))
    )
    assert.equal(built[0]!.sha256, digest('executable'))
    await assertReleasedMigrationFiles(built, [
      { name, absPath: join(root, 'build', `${name}.js`) },
    ])
    await writeFile(join(root, 'build', `${name}.js`), 'changed executable')
    await assert.rejects(
      () =>
        assertReleasedMigrationFiles(built, [{ name, absPath: join(root, 'build', `${name}.js`) }]),
      /Released migration changed/
    )
    await writeFile(join(root, 'build', `${name}.js`), 'executable')
    await assert.rejects(() => assertReleasedMigrationFiles(built, []), /differ from the released/)
    await assert.rejects(
      () =>
        assertReleasedMigrationFiles(built, [
          { name, absPath: join(root, 'build', `${name}.js`) },
          { name: 'database/migrations/extra', absPath: join(root, 'build', `${name}.js`) },
        ]),
      /differ from the released/
    )

    await writeFile(join(root, `${name}.ts`), 'changed source')
    await assert.rejects(() => releasedMigrationsHook(bundler), /Released migration changed/)
    await writeFile(join(root, `${name}.ts`), 'source')
    await writeFile(join(root, 'build/database/migrations/extra.js'), 'extra')
    await assert.rejects(() => releasedMigrationsHook(bundler), /differ from the released manifest/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upgrade fallback creates a private backup directory without changing its parent', async ({
  assert,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'capacitylens-upgrade-'))
  try {
    const databasePath = join(root, 'live.db')
    const database = openNativeDatabase(databasePath)
    try {
      database.prepare('CREATE TABLE entries (id INTEGER PRIMARY KEY)').run()
      const parent = await stat(root)
      const parentMode = parent.mode & 0o777
      const dir = preMigrationBackupDirectory(databasePath)
      const file = join(dir, 'capacitylens-pre-migration-v0-to-v1.db')
      ensurePrivateBackupDirectory(dir)
      await writeOneShotSnapshot({ database, dir, file })
      const afterParent = await stat(root)
      const backupDirectory = await stat(dir)
      const backupFile = await stat(file)
      assert.equal(afterParent.mode & 0o777, parentMode)
      assert.equal(backupDirectory.mode & 0o777, 0o700)
      assert.equal(backupFile.mode & 0o777, 0o600)
      assert.equal(
        preMigrationBackupDirectory(databasePath, join(root, 'configured')),
        join(root, 'configured')
      )
    } finally {
      database.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
