import { DatabaseSync } from 'node:sqlite'

/**
 * Confirms and admits a signed-up identity in a disposable E2E database, standing in for the
 * confirmation email and the operator's approval that a real installation needs.
 * @throws When the identity is absent.
 */
export function admitIdentity(databasePath, email) {
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const now = new Date().toISOString()
    const user = db
      .prepare('SELECT id, email FROM users WHERE lower(email) = ?')
      .get(email.toLowerCase())
    if (!user) throw new Error(`Missing E2E identity for ${email}`)
    db.prepare('UPDATE users SET email_verified_at = ?, unverified_email = NULL WHERE id = ?').run(
      now,
      user.id
    )
    db.prepare(
      `INSERT INTO account_admissions
         (user_id, invited_email, invitation_source, invitation_recorded_at, approval_status,
          approval_decided_at, created_at, updated_at)
       VALUES (?, ?, 'operator', ?, 'approved', ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         invitation_recorded_at = excluded.invitation_recorded_at,
         approval_status = 'approved',
         approval_decided_at = excluded.approval_decided_at`
    ).run(user.id, user.email, now, now, now, now)
  } finally {
    db.close()
  }
}
