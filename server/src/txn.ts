import type { Db } from './db'

/** Run fn inside a BEGIN/COMMIT transaction, rolling back (and rethrowing) on any throw.
 *  Shared by the bulk writes in db.ts and the tasks-table rebuild in schema.ts, so both
 *  speak one transaction discipline. */
export function tx(db: Db, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
