import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'

test.group('Backup diagnostics', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('readiness reports database health without a backup latch', async ({ client, assert }) => {
    const response = await client.get('/health/ready')
    assert.equal(response.status(), 200)
    assert.equal(
      response.body().checks.some((check: { name: string }) => check.name === 'Backups'),
      false
    )
  })

  test('diagnostics keeps the compatibility backup projection explicitly unavailable', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/api/diagnostics')
    assert.equal(response.status(), 200)
    assert.deepEqual(response.body().server.backup, {
      status: 'unavailable',
      lastSuccessAt: null,
    })
  })

  test('unknown recorded migrations fail readiness while liveness remains available', async ({
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
