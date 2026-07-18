import type { Db } from './db'

let savepointId = 0

/** Run fn atomically, rolling back (and rethrowing) on any throw.
 *
 * A top-level caller may request `IMMEDIATE` when it must reserve SQLite's single writer before
 * inspecting/mutating schema. Nested callers use SAVEPOINTs, which lets one explicit database
 * migration wrap the older focused helpers (table rebuilds, control-table repair, data repair)
 * without either weakening their local atomicity or attempting an invalid nested BEGIN.
 */
export function tx<T>(db: Db, fn: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
  if (db.isTransaction) {
    const savepoint = `capacitylens_tx_${++savepointId}`
    db.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = fn()
      db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (e) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      } catch (rollbackError) {
        console.error('tx: SAVEPOINT rollback failed after an error; preserving the original cause', rollbackError)
      }
      throw e
    }
  }

  db.exec(mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    // Roll back, but NEVER let a ROLLBACK failure MASK the original error. If BEGIN never armed a
    // transaction or the connection is gone, db.exec('ROLLBACK') itself throws — swallow ONLY that
    // (after logging), then always rethrow `e`, the real cause, so the diagnostic chain stays
    // intact. The rare acceptable nested swallow: the original failure is still surfaced.
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError) {
      console.error('tx: ROLLBACK failed after an error; preserving the original cause', rollbackError)
    }
    throw e
  }
}
