import { DateTime } from 'luxon'
import type { AccountUser, Trx, UserId, UsersAdapter } from 'adonisjs-account-kit/types'
import db from '@adonisjs/lucid/services/db'
import { hashPassword, verifyPassword } from '#services/password_service'

function accountUser(row: Record<string, unknown> | undefined): AccountUser | null {
  if (!row) return null
  return {
    id: String(row.id),
    email: String(row.email),
    hasPassword: typeof row.password_hash === 'string' && row.password_hash.length > 0,
    // The boolean is authoritative; the timestamp is only the package's read view.
    emailVerifiedAt: row.email_verified ? DateTime.fromISO(String(row.updated_at)) : null,
  }
}

/** Product user storage for the package; every supplied transaction stays on that transaction. */
export const usersAdapter: UsersAdapter = {
  async findByEmail(email, trx) {
    return accountUser(await (trx ?? db).from('users').where('email', email).first())
  },
  async findById(id, trx) {
    return accountUser(await (trx ?? db).from('users').where('id', String(id)).first())
  },
  async create() {
    throw new Error('Package-owned invitations and registration are disabled.')
  },
  async setPassword(id: UserId, password: string, trx: Trx) {
    const current = await trx.from('users').where('id', String(id)).select('password_hash').first()
    if (!current || !current.password_hash) throw new PasswordIneligibleError()
    const hash = await hashPassword(password)
    await trx
      .from('users')
      .where('id', String(id))
      .update({ password_hash: hash, updated_at: new Date().toISOString() })
  },
  async setEmail() {
    throw new Error('Email changes are unavailable.')
  },
  async markEmailVerified(id, _at: DateTime, trx) {
    await trx
      .from('users')
      .where('id', String(id))
      .update({ email_verified: true, updated_at: new Date().toISOString() })
  },
  async verifyPassword(id, password, trx) {
    const row = await trx.from('users').where('id', String(id)).select('password_hash').first()
    return (
      typeof row?.password_hash === 'string' && (await verifyPassword(row.password_hash, password))
    )
  },
}

export class PasswordIneligibleError extends Error {
  readonly code = 'PASSWORD_UNAVAILABLE'
  readonly status = 403
  constructor() {
    super('Password recovery is unavailable for this account.')
  }
}
