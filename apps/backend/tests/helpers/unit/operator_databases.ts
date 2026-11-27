import { DatabaseSync } from 'node:sqlite'
import db from '@adonisjs/lucid/services/db'
import type { operatorFixture } from '#tests/helpers/operator_command_helpers'

/** The number of rows in a table of an operator database. */
export function tableCount(database: DatabaseSync, table: string) {
  return database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n
}

/** The company names stored in the SQLite database at `databasePath`. */
export function companyNames(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return database
      .prepare('SELECT name FROM companies ORDER BY name')
      .all()
      .map((row) => row.name)
  } finally {
    database.close()
  }
}

/** The `company:initialize` arguments, with the spacing and case the command normalises. */
export const initializeArgs = [
  'company:initialize',
  '  Bruce@Wayne.EXAMPLE ',
  '  Wayne   Enterprises  ',
  '--confirm-server-stopped',
]

type Inspection = ReturnType<ReturnType<typeof operatorFixture>['inspect']>

/** A confirmed identity with a password and the invitation and approval admission requires. */
export function insertAdmittedUser(database: Inspection, options: { admitted?: boolean } = {}) {
  const now = new Date().toISOString()
  database
    .prepare(
      'INSERT INTO users (id,email,email_verified_at,display_name,password,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run('bruce', 'bruce@wayne.example', now, 'Bruce Wayne', 'existing-credential', now, now)
  if (options.admitted === false) return
  database
    .prepare(
      `INSERT INTO account_admissions (user_id,invited_email,invited_role,invitation_source,
        invitation_recorded_at,approval_status,approval_decided_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run('bruce', 'bruce@wayne.example', 'viewer', 'operator', now, 'approved', now, now, now)
}

/** The number of rows in a table of the suite's database. */
export async function countRows(table: string) {
  const row = await db.from(table).count('* as n').first()
  return Number(row?.n ?? 0)
}
