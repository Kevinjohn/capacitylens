import { existsSync, lstatSync } from 'node:fs'
import db from '@adonisjs/lucid/services/db'
import type { NativeDatabase } from '#services/backup/native'

/** Require operator intent and an existing disk database before opening any connection. */
export function operatorDatabasePath(confirmServerStopped: boolean) {
  if (!confirmServerStopped) throw new Error('Refusing without --confirm-server-stopped')
  const config = db.getRawConnection(db.primaryConnectionName)?.config
  if (config?.client !== 'better-sqlite3' || config.pool?.max !== 1)
    throw new Error('Operator commands require the configured single-connection SQLite pool')
  const path = config.connection.filename as string
  if (path === ':memory:' || !existsSync(path) || !lstatSync(path).isFile())
    throw new Error('Operator commands require an existing on-disk database')
  return path
}

/** Keep the pool's sole handle exclusively locked while account-kit owns its transactions. */
export async function withOperatorDatabase<T>(
  run: (connection: NativeDatabase) => Promise<T>
): Promise<T> {
  let failure: unknown
  let failed = false
  let result!: T
  try {
    const client = db.connection().getWriteClient().client
    const connection = await client.acquireConnection()
    let lockFailure: unknown
    try {
      connection.pragma('busy_timeout = 0')
      connection.pragma('locking_mode = EXCLUSIVE')
      try {
        connection.exec('BEGIN EXCLUSIVE; COMMIT')
      } catch (cause) {
        throw new Error('Another process holds this database; stop the server and retry', { cause })
      }
    } catch (error) {
      lockFailure = error
    }
    try {
      await client.releaseConnection(connection)
    } catch (cleanup) {
      if (lockFailure !== undefined)
        throw new AggregateError([lockFailure, cleanup], 'Operator lock release failed')
      throw cleanup
    }
    if (lockFailure !== undefined) throw lockFailure
    result = await run(connection as NativeDatabase)
  } catch (error) {
    failure = error
    failed = true
  }
  // Closing the sole handle releases EXCLUSIVE mode even after acquisition or lock failure.
  try {
    await db.manager.closeAll()
  } catch (cleanup) {
    if (failed) throw new AggregateError([failure, cleanup], 'Operator database cleanup failed')
    throw cleanup
  }
  if (failed) throw failure
  return result
}
