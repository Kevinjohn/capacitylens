import type { Db } from './db'

/** Run fn inside a BEGIN/COMMIT transaction, rolling back (and rethrowing) on any throw.
 *  Shared by the bulk writes in db.ts and the activities-table rebuild in schema.ts, so both
 *  speak one transaction discipline. */
export function tx(db: Db, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
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
