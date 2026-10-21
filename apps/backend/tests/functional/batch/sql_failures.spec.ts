import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import HttpExceptionHandler from '#exceptions/handler'
import { applyBatch } from '#services/batch/service'
import { trustedLocalDataContext } from '#services/batch/data_policy'
import { readStateWithClient, replaceWithSeed } from '#services/state_repository'
import { withTransaction } from '#services/with_transaction'

async function capture(work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    return error
  }
  throw new Error('The expected failure did not occur.')
}

async function classify(error: unknown) {
  const ctx = await testUtils.createHttpContext()
  const handler = new HttpExceptionHandler()
  await handler.handle(error, ctx)
  return { status: ctx.response.getStatus(), body: ctx.response.getBody() as unknown }
}

test.group('M2a SQL failure and audit contracts', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => replaceWithSeed())

  test('maps real NOT NULL, primary-key, unique and foreign-key row constraints to a safe 400', async ({
    assert,
  }) => {
    const constraintSession = {
      session_id: 'm2a-constraint-session',
      last_sequence: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    await db.table('capacitylens_sync_sessions').insert(constraintSession)
    const statements = [
      [
        'INSERT INTO accounts (id,name,color,created_at,updated_at) VALUES (?,NULL,?,?,?)',
        ['m2a-notnull', '#2d75da', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
      ],
      [
        'INSERT INTO accounts (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)',
        [
          'a-studio',
          'Wayne Enterprises',
          '#2d75da',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        ],
      ],
      [
        'INSERT INTO capacitylens_sync_sessions (session_id,last_sequence,updated_at) VALUES (?,?,?)',
        ['m2a-constraint-session', 1, '2026-01-01T00:00:00.000Z'],
      ],
      [
        'INSERT INTO clients (id,account_id,name,color,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [
          'm2a-foreign',
          'missing-company',
          'Wayne Foundation',
          '#2d75da',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        ],
      ],
    ] as const
    for (const [sql, bindings] of statements) {
      const error = await capture(() => db.rawQuery(sql, [...bindings]))
      const reply = await classify(error)
      assert.equal(reply.status, 400, String((error as { code?: unknown }).code))
      assert.deepEqual(reply.body, {
        error: 'That change references missing data or conflicts with an existing record.',
      })
      assert.notInclude(JSON.stringify(reply.body), sql)
    }
  })

  test('redacts arbitrary decorated exceptions and constraint-like messages as 500', async ({
    assert,
  }) => {
    const sentinel = 'Private database locator and field value'
    for (const error of [
      Object.assign(new Error(sentinel), { statusCode: 400 }),
      Object.assign(new Error(sentinel), { statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' }),
      new Error('upstream constraint failed unexpectedly'),
      'unexpected scalar',
    ]) {
      const reply = await classify(error)
      assert.equal(reply.status, 500)
      assert.deepEqual(reply.body, { error: 'Internal server error.' })
      assert.notInclude(JSON.stringify(reply.body), sentinel)
    }
  })

  test('rolls back a single inserted row when its required audit write fails', async ({
    assert,
  }) => {
    const initial = await readStateWithClient(db.connection(), 'a-studio', true)
    const base = initial.disciplines[0]!
    await db.rawQuery(
      "CREATE TRIGGER m2a_fail_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'private audit failure'); END"
    )
    try {
      const error = await capture(() =>
        withTransaction((trx) =>
          applyBatch(
            trx,
            [
              {
                method: 'PUT',
                table: 'disciplines',
                id: 'm2a-failed-insert',
                row: { ...base, id: 'm2a-failed-insert' },
              },
            ],
            null,
            trustedLocalDataContext('bruce-wayne')
          )
        )
      )
      const reply = await classify(error)
      assert.equal(reply.status, 500)
      assert.deepEqual(reply.body, { error: 'Internal server error.' })
      assert.isNull(await db.from('disciplines').where('id', 'm2a-failed-insert').first())
      assert.isNull(await db.from('audit_entries').where('entity_id', 'm2a-failed-insert').first())
      assert.deepEqual(await readStateWithClient(db.connection(), 'a-studio', true), initial)
    } finally {
      await db.rawQuery('DROP TRIGGER m2a_fail_audit')
    }
  })

  test('rolls back a single upsert update when its required audit write fails', async ({
    assert,
  }) => {
    const initial = await readStateWithClient(db.connection(), 'a-studio', true)
    const base = initial.disciplines[0]!
    await db.rawQuery(
      "CREATE TRIGGER m2a_fail_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'private audit failure'); END"
    )
    try {
      const error = await capture(() =>
        withTransaction((trx) =>
          applyBatch(
            trx,
            [
              {
                method: 'PUT',
                table: 'disciplines',
                id: base.id,
                row: { ...base, name: 'Rejected scheduling detail' },
              },
            ],
            null,
            trustedLocalDataContext('bruce-wayne')
          )
        )
      )
      const reply = await classify(error)
      assert.equal(reply.status, 500)
      assert.deepEqual(await readStateWithClient(db.connection(), 'a-studio', true), initial)
      assert.isNull(await db.from('audit_entries').where('entity_id', base.id).first())
    } finally {
      await db.rawQuery('DROP TRIGGER m2a_fail_audit')
    }
  })

  test('records one SQL audit row with field names and no changed values', async ({ assert }) => {
    const initial = await readStateWithClient(db.connection(), 'a-studio', true)
    const base = initial.disciplines[0]!
    const sentinel = 'Private changed scheduling value'
    await withTransaction((trx) =>
      applyBatch(
        trx,
        [{ method: 'PUT', table: 'disciplines', id: base.id, row: { ...base, name: sentinel } }],
        null,
        trustedLocalDataContext('bruce-wayne')
      )
    )
    const rows = await db.from('audit_entries').where('entity_id', base.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].account_id, 'a-studio')
    assert.equal(rows[0].actor_id, 'bruce-wayne')
    assert.equal(rows[0].action, 'update')
    assert.equal(rows[0].entity, 'disciplines')
    const changedFields = JSON.parse(rows[0].details).changedFields as string[]
    assert.include(changedFields, 'name')
    assert.isTrue(changedFields.every((field) => Object.hasOwn(base, field) || field === 'name'))
    assert.notInclude(JSON.stringify(rows), sentinel)
  })
})
