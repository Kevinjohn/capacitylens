import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import { encodeRow } from '#services/state_repository'
import { readState } from '#services/state_repository'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '../helpers/fresh_database.js'

test.group('M2b data contract', () => {
  test('returns explicit null from a persisted optional column', async ({ assert }) => {
    await freshDatabase()
    const data = seed()
    const account = data.accounts[0]!
    await db
      .table('accounts')
      .insert(encodeRow('accounts', account as unknown as Record<string, unknown>))
    const state = await readState(account.id, true)
    assert.property(state.accounts[0], 'timezone')
    assert.isNull(state.accounts[0]?.timezone)
  })
  test('encodes explicit null for a cleared optional field', ({ assert }) => {
    const data = seed()
    const resource = data.resources[0]!
    const encoded = encodeRow('resources', { ...resource, avatarUrl: null })
    assert.property(encoded, 'avatar_url')
    assert.isNull(encoded.avatar_url)
  })
})
