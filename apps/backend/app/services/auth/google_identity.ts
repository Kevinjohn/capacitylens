import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import User from '#models/user'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import {
  registerProviderSession,
  resolveCurrentActor,
  assertFreshSession,
} from './session_authority.js'
import { recordMemberSignIn } from '#services/membership/sign_in_tracking'
import { hasCurrentEmailProof } from '#services/admission/joining_policy'

export const GOOGLE_ISSUER = 'https://accounts.google.com'

export class GoogleIdentityError extends Error {
  constructor(
    message: string,
    readonly status = 403,
    readonly code = 'GOOGLE_IDENTITY_DENIED'
  ) {
    super(message)
  }
}

export interface VerifiedGoogleProfile {
  subject: string
  email: string
  name: string | null
}

/** Requires Google's exact boolean mailbox claim; Ally alone treats a nonempty string as true. */
export function verifiedGoogleProfile(value: {
  id: unknown
  email: unknown
  name: unknown
  emailVerificationState: unknown
  original: unknown
}): VerifiedGoogleProfile {
  const original = value.original as Record<string, unknown> | null
  const email = typeof value.email === 'string' ? normalizeAccountEmail(value.email) : ''
  if (
    !original ||
    Array.isArray(original) ||
    original.email_verified !== true ||
    value.emailVerificationState !== 'verified' ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    original.sub !== value.id ||
    !isAccountEmail(email)
  )
    throw new GoogleIdentityError('Google did not verify this identity.')
  return { subject: value.id, email, name: typeof value.name === 'string' ? value.name : null }
}

async function recordProof(trx: TransactionClientContract, userId: string, email: string) {
  const owner = await trx
    .from('memberships as member')
    .innerJoin(
      'account_access_restrictions as restriction',
      'restriction.account_id',
      'member.account_id'
    )
    .where({ 'member.user_id': userId, 'member.role': 'owner', 'member.status': 'active' })
    .andWhere((query) =>
      query.where('restriction.principal_id', userId).orWhere('restriction.verified_email', email)
    )
    .first()
  if (owner)
    throw new GoogleIdentityError('Google identity cannot be linked.', 403, 'GOOGLE_LINK_DENIED')
  const now = new Date().toISOString()
  await trx
    .table('email_proofs')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['user_id', 'email'])
    .merge(['verified_at', 'updated_at'])
  await trx.from('users').where('id', userId).update({ email_verified: true, updated_at: now })
}

async function createGoogleIdentity(
  trx: TransactionClientContract,
  profile: VerifiedGoogleProfile,
  invitationId?: string
) {
  await trx.from('account_transaction_lock').where('id', 1).increment('version', 1)
  const existingUser = await trx.from('users').where('email', profile.email).first()
  if (existingUser)
    throw new GoogleIdentityError(
      'Connect Google from your existing account.',
      409,
      'GOOGLE_LINK_REQUIRED'
    )
  const hasUsers = Boolean(await trx.from('users').select('id').first())
  if (!hasUsers) {
    const allowlist = (env.get('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS') || '')
      .split(',')
      .map(normalizeAccountEmail)
    if (!allowlist.includes(profile.email))
      throw new GoogleIdentityError('Google sign-in is unavailable.')
  } else {
    let query = trx.from('invitations').where({ email: profile.email, accepted_at: null })
    if (invitationId) query = query.where('id', invitationId)
    const invite = await query.where('expires_at', '>', new Date().toISOString()).first()
    if (!invite) throw new GoogleIdentityError('Google sign-in requires an invitation.')
    const restricted = await trx
      .from('account_access_restrictions')
      .where({ account_id: invite.account_id, verified_email: profile.email })
      .first()
    if (restricted) throw new GoogleIdentityError('Google sign-in is unavailable.')
  }
  const now = new Date().toISOString()
  const userId = crypto.randomUUID()
  await trx.table('users').insert({
    id: userId,
    email: profile.email,
    email_verified: true,
    display_name: profile.name,
    password_hash: null,
    created_at: now,
    updated_at: now,
  })
  await trx.table('provider_identities').insert({
    id: crypto.randomUUID(),
    user_id: userId,
    provider: 'google',
    issuer: GOOGLE_ISSUER,
    subject: profile.subject,
    email: profile.email,
    created_at: now,
    updated_at: now,
  })
  return userId
}

/** Finds or admits only the callback's stable Google subject, never its email as a link key. */
export async function googleSignInUser(
  trx: TransactionClientContract,
  profile: VerifiedGoogleProfile,
  invitationId?: string
) {
  const identity = await trx
    .from('provider_identities')
    .where({ provider: 'google', issuer: GOOGLE_ISSUER, subject: profile.subject })
    .first()
  const userId = identity
    ? String(identity.user_id)
    : await createGoogleIdentity(trx, profile, invitationId)
  const user = await trx.from('users').where('id', userId).first()
  if (!user) throw new GoogleIdentityError('Google identity is unavailable.')
  if (String(user.email) === profile.email) await recordProof(trx, userId, profile.email)
  return { userId, user: await User.query({ client: trx }).where('id', userId).firstOrFail() }
}

/** Links only a fresh current principal after matching verified mailbox proof. */
export async function linkGoogleIdentity(
  ctx: HttpContext,
  profile: VerifiedGoogleProfile,
  expectedUserId: string,
  expectedSessionId: string,
  trx: TransactionClientContract
) {
  const actor = await resolveCurrentActor(ctx, trx)
  if (actor.userId !== expectedUserId || actor.sessionId !== expectedSessionId)
    throw new GoogleIdentityError('Google link session changed.')
  assertFreshSession(actor)
  if (
    actor.user.email !== profile.email ||
    !(await hasCurrentEmailProof(trx, actor.userId, profile.email))
  )
    throw new GoogleIdentityError(
      'Verify the local account address before connecting Google.',
      403,
      'LOCAL_EMAIL_NOT_VERIFIED'
    )
  const existing = await trx
    .from('provider_identities')
    .where({ provider: 'google', issuer: GOOGLE_ISSUER, subject: profile.subject })
    .first()
  if (existing && existing.user_id !== actor.userId)
    throw new GoogleIdentityError(
      'Google is connected to another account.',
      409,
      'GOOGLE_LINK_CONFLICT'
    )
  const other = await trx
    .from('provider_identities')
    .where({ provider: 'google', user_id: actor.userId })
    .first()
  if (other && other.subject !== profile.subject)
    throw new GoogleIdentityError(
      'A different Google identity is already connected.',
      409,
      'GOOGLE_LINK_CONFLICT'
    )
  if (!existing) {
    const now = new Date().toISOString()
    await trx.table('provider_identities').insert({
      id: crypto.randomUUID(),
      user_id: actor.userId,
      provider: 'google',
      issuer: GOOGLE_ISSUER,
      subject: profile.subject,
      email: profile.email,
      created_at: now,
      updated_at: now,
    })
  }
  await recordProof(trx, actor.userId, profile.email)
  return actor.userId
}

/** Rotates and registers a native Google session against the current provider identity. */
export async function createGoogleSession(
  ctx: HttpContext,
  user: User,
  subject: string,
  trx: TransactionClientContract
) {
  const previousSessionId = ctx.session.sessionId
  await ctx.auth.use('web').login(user)
  const authenticatedAt = Date.now()
  const sessionId = ctx.session.sessionId
  ctx.session.put('authenticatedAt', authenticatedAt)
  ctx.session.put('lastActivityAt', authenticatedAt)
  ctx.session.put('authenticationProvider', 'google')
  await registerProviderSession(
    {
      userId: String(user.id),
      sessionId,
      provider: 'google',
      issuer: GOOGLE_ISSUER,
      subject,
      authenticatedAt,
    },
    trx
  )
  await recordMemberSignIn(String(user.id), trx)
  if (previousSessionId !== sessionId)
    await trx.from('user_session_index').where('session_id', previousSessionId).delete()
  return sessionId
}

/** Session tagging occurs only after the principal and index transaction commits. */
export async function tagGoogleSession(ctx: HttpContext, sessionId: string, userId: string) {
  try {
    await ctx.session.tag(userId)
  } catch (error) {
    await db.from('user_session_index').where({ user_id: userId, session_id: sessionId }).delete()
    throw error
  }
}
