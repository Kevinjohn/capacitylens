import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { withOperatorDatabase } from '#services/operations/operator_database'

test('operator lock failures close the pool across acquisition, setup and callback boundaries', async ({
  assert,
}) => {
  const originalConnection = db.connection
  const originalClose = db.manager.closeAll
  try {
    for (const stage of ['acquire', 'setup', 'release', 'callback'] as const) {
      let closed = false
      let callbackEntered = false
      const failure = new Error(`fixture-${stage}`)
      db.manager.closeAll = async () => {
        closed = true
      }
      const client = {
        async acquireConnection() {
          if (stage === 'acquire') throw failure
          return {
            pragma() {
              if (stage === 'setup') throw failure
            },
            exec() {},
          }
        },
        async releaseConnection() {
          if (stage === 'release') throw failure
        },
      }
      db.connection = (() => ({ getWriteClient: () => ({ client }) })) as typeof db.connection
      await assert.rejects(
        () =>
          withOperatorDatabase(async () => {
            callbackEntered = true
            throw failure
          }),
        failure.message
      )
      assert.isTrue(closed, stage)
      assert.equal(callbackEntered, stage === 'callback')
    }
    const failure = new Error('original acquisition failure')
    const cleanup = new Error('pool cleanup failure')
    db.connection = (() => {
      throw failure
    }) as typeof db.connection
    db.manager.closeAll = async () => {
      throw cleanup
    }
    try {
      await withOperatorDatabase(async () => undefined)
      assert.fail('Expected both failures')
    } catch (error) {
      assert.instanceOf(error, AggregateError)
      assert.deepEqual((error as AggregateError).errors, [failure, cleanup])
    }
  } finally {
    db.connection = originalConnection
    db.manager.closeAll = originalClose
  }
})
