import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.group('Backup diagnostics', (group) => {
  group.setup(() => freshDatabase())

  test('readiness reports database health without a backup latch', async ({ client, assert }) => {
    const response = await client.get('/health/ready')
    assert.equal(response.status(), 200)
    assert.equal(
      response.body().checks.some((check: { name: string }) => check.name === 'Backups'),
      false
    )
  })

  test('diagnostics reports the last applied migration and no snapshot when none exists', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/api/diagnostics')
    const latest = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first()
    assert.equal(response.status(), 200)
    assert.equal(response.body().server.schema.migration, latest!.name)
    assert.deepEqual(response.body().server.backup, { newestSnapshotAt: null })
    assert.notProperty(response.body().server, 'persistence')
  })

  test('an unreadable backup directory does not erase verified database diagnostics', async ({
    client,
    assert,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'))
    const original = env.get('CAPACITYLENS_BACKUP_DIR')
    try {
      env.set('CAPACITYLENS_BACKUP_DIR', join(root, 'missing'))
      const latest = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first()
      const response = await client.get('/api/diagnostics')
      assert.equal(response.status(), 200)
      assert.deepEqual(response.body().server, {
        connectivity: 'ok',
        database: { status: 'ok' },
        schema: { migration: latest!.name },
        backup: { newestSnapshotAt: null },
      })
    } finally {
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '')
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('diagnostics uses the newest snapshot file mtime, not its filename date', async ({
    client,
    assert,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'))
    const original = env.get('CAPACITYLENS_BACKUP_DIR')
    try {
      const older = join(dir, 'capacitylens-utc-20261020-120000-000.db')
      const newer = join(dir, 'capacitylens-utc-20261021-120000-000.db')
      writeFileSync(older, 'old')
      writeFileSync(newer, 'new')
      writeFileSync(join(dir, 'unrelated.db'), 'ignore')
      utimesSync(older, new Date('2026-10-21T23:00:00.000Z'), new Date('2026-10-21T23:00:00.000Z'))
      utimesSync(newer, new Date('2026-10-20T08:12:13.000Z'), new Date('2026-10-20T08:12:13.000Z'))
      env.set('CAPACITYLENS_BACKUP_DIR', dir)
      const response = await client.get('/api/diagnostics')
      assert.equal(response.status(), 200)
      assert.deepEqual(response.body().server.backup, {
        newestSnapshotAt: '2026-10-21T23:00:00.000Z',
      })
    } finally {
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
