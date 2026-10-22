import { test } from '@japa/runner'
import { existsSync } from 'node:fs'
import { operatorFixture } from './operator_command_support.js'

test('db:seed preserves existing product changes and audit history', ({ assert }) => {
  const fixture = operatorFixture()
  try {
    assert.equal(fixture.command(['app:upgrade']).status, 0)
    const first = fixture.command(['db:seed'])
    assert.equal(first.status, 0, first.output)
    const database = fixture.inspect()
    const account = database.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get() as {
      id: string
    }
    const now = new Date().toISOString()
    database
      .prepare('UPDATE accounts SET name = ? WHERE id = ?')
      .run('Wayne Operations', account.id)
    database
      .prepare(
        'INSERT INTO audit_entries (id,account_id,action,entity,created_at,updated_at) VALUES (?,?,?,?,?,?)'
      )
      .run('seed-survival', account.id, 'operator.note', 'installation', now, now)
    const before = Object.fromEntries(
      [
        'accounts',
        'clients',
        'disciplines',
        'projects',
        'phases',
        'resources',
        'activities',
        'allocations',
        'time_off',
        'closures',
      ].map((table) => [
        table,
        Number(
          (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
            .count
        ),
      ])
    )
    database.close()
    const second = fixture.command(['db:seed'])
    assert.equal(second.status, 0, second.output)
    const after = fixture.inspect()
    assert.equal(
      (after.prepare('SELECT name FROM accounts WHERE id = ?').get(account.id) as { name: string })
        .name,
      'Wayne Operations'
    )
    assert.equal(
      (
        after
          .prepare('SELECT COUNT(*) AS count FROM audit_entries WHERE id = ?')
          .get('seed-survival') as { count: number }
      ).count,
      1
    )
    for (const [table, count] of Object.entries(before))
      assert.equal(
        (after.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
        count,
        table
      )
    after.close()
    assert.isTrue(existsSync(fixture.databasePath))
  } finally {
    fixture.cleanup()
  }
})
