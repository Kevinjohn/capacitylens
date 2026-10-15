import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { SessionCollection } from '@adonisjs/session'
import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type User from '#models/user'
import { authMode } from './mode.js'

const ABSOLUTE_MS = 12 * 60 * 60 * 1000
const IDLE_MS = 30 * 60 * 1000
const FRESH_MS = 15 * 60 * 1000
const TOUCH_MS = 60 * 1000

export class SessionAuthorityError extends Error {
  constructor(
    message: string,
    readonly code = 'SESSION_INVALID',
    readonly status = 401
  ) {
    super(message)
  }
}

export interface CurrentActor {
  user: User
  userId: string
  sessionId: string
  authenticatedAt: number
  lastActivityAt: number
}

function validTime(value: unknown, now: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= now
}

function parseIndex(row: Record<string, unknown> | undefined, now: number) {
  if (!row) throw new SessionAuthorityError('Session revoked.')
  const authenticatedAt = row.authenticated_at
  const lastActivityAt = row.last_activity_at
  if (!validTime(authenticatedAt, now) || !validTime(lastActivityAt, now))
    throw new SessionAuthorityError('Invalid session metadata.')
  if (lastActivityAt < authenticatedAt) throw new SessionAuthorityError('Invalid session metadata.')
  return { authenticatedAt, lastActivityAt }
}

/** A stale expiry may remove only the activity version it inspected. */
export async function expireIdleIndexIfUnchanged(
  userId: string,
  sessionId: string,
  observedLastActivityAt: number,
  now: number,
  connection: Pick<typeof db, 'from'> = db
) {
  const removed = await connection
    .from('user_session_index')
    .where({ user_id: userId, session_id: sessionId, last_activity_at: observedLastActivityAt })
    .delete()
  if (removed) throw new SessionAuthorityError('Session expired.')
  const winner = parseIndex(
    await connection
      .from('user_session_index')
      .where({ user_id: userId, session_id: sessionId })
      .first(),
    now
  )
  if (now - winner.lastActivityAt >= IDLE_MS) throw new SessionAuthorityError('Session expired.')
  return winner
}

/** A losing touch adopts the newer committed activity instead of moving it backwards. */
export async function touchIndexIfUnchanged(
  userId: string,
  sessionId: string,
  observedLastActivityAt: number,
  now: number,
  connection: Pick<typeof db, 'from'> = db
) {
  const updated = await connection
    .from('user_session_index')
    .where({ user_id: userId, session_id: sessionId, last_activity_at: observedLastActivityAt })
    .update({ last_activity_at: now })
  if (updated) return { lastActivityAt: now }
  return parseIndex(
    await connection
      .from('user_session_index')
      .where({ user_id: userId, session_id: sessionId })
      .first(),
    now
  )
}

/** Registers only a session proved against the current stored credential. */
export async function registerProvenSession(
  input: {
    userId: string
    sessionId: string
    credentialHash: string
    authenticatedAt: number
  },
  trx: TransactionClientContract
) {
  const user = await trx.from('users').where('id', input.userId).select('password_hash').first()
  if (!user || user.password_hash !== input.credentialHash)
    throw new SessionAuthorityError('Credentials changed during sign-in.')
  await trx.table('user_session_index').insert({
    user_id: input.userId,
    session_id: input.sessionId,
    authenticated_at: input.authenticatedAt,
    last_activity_at: input.authenticatedAt,
  })
}

/** Registers a Google session only while its stable provider binding remains current. */
export async function registerProviderSession(
  input: {
    userId: string
    sessionId: string
    provider: string
    issuer: string
    subject: string
    authenticatedAt: number
  },
  trx: TransactionClientContract
) {
  const identity = await trx
    .from('provider_identities as identity')
    .innerJoin('users as user', 'user.id', 'identity.user_id')
    .where({
      'identity.provider': input.provider,
      'identity.issuer': input.issuer,
      'identity.subject': input.subject,
      'identity.user_id': input.userId,
    })
    .select('user.id')
    .first()
  if (!identity) throw new SessionAuthorityError('Provider identity changed during sign-in.')
  await trx.table('user_session_index').insert({
    user_id: input.userId,
    session_id: input.sessionId,
    authenticated_at: input.authenticatedAt,
    last_activity_at: input.authenticatedAt,
  })
}

/** Deletes index authority within the caller's transaction and returns exact native IDs to clean later. */
export async function invalidateUserSessions(
  input: { userId: string; preserveSessionId?: string },
  trx: TransactionClientContract
): Promise<string[]> {
  let query = trx.from('user_session_index').where('user_id', input.userId)
  if (input.preserveSessionId) query = query.whereNot('session_id', input.preserveSessionId)
  const rows = await query.select('session_id')
  const ids = rows.map((row) => String(row.session_id))
  if (ids.length) await trx.from('user_session_index').whereIn('session_id', ids).delete()
  return ids
}

/** Physical cleanup follows commit; missing index authority already makes the sessions unusable. */
export async function destroyNativeSessions(ids: readonly string[]) {
  if (!ids.length) return
  const collection = await app.container.make(SessionCollection)
  for (const id of ids) await collection.destroy(id)
}

/** Resolves the real signed-in actor against the index, including concurrent touches and revocation. */
export async function resolveCurrentActor(
  ctx: HttpContext,
  connection: Pick<typeof db, 'from'> = db
): Promise<CurrentActor> {
  const user = (await ctx.auth.use('web').authenticate()) as User
  const sessionId = ctx.session.sessionId
  const now = Date.now()
  const lookup = () =>
    connection
      .from('user_session_index')
      .where({ user_id: String(user.id), session_id: sessionId })
      .first()
  let times = parseIndex(await lookup(), now)
  const nativeAuthenticatedAt: unknown = ctx.session.get('authenticatedAt')
  const nativeLastActivityAt: unknown = ctx.session.get('lastActivityAt')
  if (authMode() === 'sso-only' && ctx.session.get('authenticationProvider') !== 'google')
    throw new SessionAuthorityError('Google sign-in is required.')
  if (
    !validTime(nativeAuthenticatedAt, now) ||
    !validTime(nativeLastActivityAt, now) ||
    nativeAuthenticatedAt !== times.authenticatedAt ||
    nativeLastActivityAt < nativeAuthenticatedAt ||
    nativeLastActivityAt > times.lastActivityAt
  )
    throw new SessionAuthorityError('Invalid native session metadata.')
  if (now - times.authenticatedAt >= ABSOLUTE_MS) {
    await connection
      .from('user_session_index')
      .where({ user_id: String(user.id), session_id: sessionId })
      .delete()
    throw new SessionAuthorityError('Session expired.')
  }
  if (now - times.lastActivityAt >= IDLE_MS) {
    times = await expireIdleIndexIfUnchanged(
      String(user.id),
      sessionId,
      times.lastActivityAt,
      now,
      connection
    )
  }
  if (now - times.lastActivityAt >= TOUCH_MS) {
    const activity = await touchIndexIfUnchanged(
      String(user.id),
      sessionId,
      times.lastActivityAt,
      now,
      connection
    )
    times.lastActivityAt = activity.lastActivityAt
  }
  ctx.session.put('authenticatedAt', times.authenticatedAt)
  ctx.session.put('lastActivityAt', times.lastActivityAt)
  return { user, userId: String(user.id), sessionId, ...times }
}

/** Freshness is checked only by the six sensitive product actions. */
export function assertFreshSession(actor: CurrentActor, now = Date.now()) {
  if (now - actor.authenticatedAt >= FRESH_MS)
    throw new SessionAuthorityError('A fresh sign-in is required.', 'SESSION_NOT_FRESH', 403)
}
