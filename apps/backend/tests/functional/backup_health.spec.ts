import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { setActiveBackups, type BackupHealth } from '#services/backup/scheduler'

function activate(health: BackupHealth) {
  setActiveBackups({ health, snapshotNow: async () => '', stop: async () => {} })
}

test.group('Backup and migration readiness', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => setActiveBackups(null))

  test('disabled backups are visible without degrading readiness', async ({ client, assert }) => {
    const ready = await client.get('/health/ready')
    assert.equal(ready.status(), 200)
    const backup = ready.body().checks.find((check: { name: string }) => check.name === 'Backups')
    assert.deepEqual(backup?.meta, { status: 'unavailable', lastSuccessAt: null })
  })

  test('pending, successful and latched failed backups retain their diagnostic status', async ({
    client,
    assert,
  }) => {
    const health: BackupHealth = { degraded: false, lastSuccessAt: null }
    activate(health)
    for (const status of ['pending', 'ok', 'degraded'] as const) {
      if (status === 'ok') health.lastSuccessAt = '2026-10-13T12:00:00.000Z'
      if (status === 'degraded') health.degraded = true
      const ready = await client.get('/health/ready')
      assert.equal(ready.status(), 200)
      assert.equal(ready.body().isHealthy, true)
      const backup = ready.body().checks.find((check: { name: string }) => check.name === 'Backups')
      assert.equal(backup?.status, status === 'ok' ? 'ok' : 'warning')
      assert.deepEqual(backup?.meta, { status, lastSuccessAt: health.lastSuccessAt })
      const diagnostics = await client.get('/api/diagnostics')
      assert.equal(diagnostics.status(), 200)
      assert.deepEqual(diagnostics.body().server.backup, {
        status,
        lastSuccessAt: health.lastSuccessAt,
      })
    }
    health.lastSuccessAt = '2026-10-13T12:30:00.000Z'
    const recovered = await client.get('/api/diagnostics')
    assert.deepEqual(recovered.body().server.backup, {
      status: 'degraded',
      lastSuccessAt: health.lastSuccessAt,
    })
  })

  test('unknown recorded migrations refuse readiness while liveness remains available', async ({
    client,
    assert,
  }) => {
    await db
      .table('adonis_schema')
      .insert({ name: 'database/migrations/999999999999_unknown', batch: 999 })
    try {
      const ready = await client.get('/health/ready')
      const diagnostics = await client.get('/api/diagnostics')
      const live = await client.get('/health/live')
      assert.equal(ready.status(), 503)
      assert.equal(diagnostics.status(), 503)
      assert.equal(live.status(), 200)
    } finally {
      await db
        .from('adonis_schema')
        .where('name', 'database/migrations/999999999999_unknown')
        .delete()
    }
  })
})
