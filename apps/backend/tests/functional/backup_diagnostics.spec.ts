import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'

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
})
