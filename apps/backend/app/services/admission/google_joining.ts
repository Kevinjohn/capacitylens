import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { hasCurrentEmailProof, policyAllowsAdmission, readJoiningPolicy } from './joining_policy.js'
import { acceptInvitation, findInvitationByToken, lookupInvitation } from './invitations.js'
import {
  conflictingAdmission,
  forbiddenAdmission,
  invalidAdmission,
  missingAdmission,
} from './errors.js'
import {
  readAccountCommand,
  readCompletedAccountCommand,
  claimAccountCommand,
  completeAccountCommand,
} from '#services/account_commands'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { confirmMemberSignIn } from '#services/membership/sign_in_tracking'
import { advancePlanningRevision } from '#services/planning_revision'
import { writeAudit } from '#services/audit'
import { affectedRows } from './affected_rows.js'
import type { VerifiedGoogleProfile } from '#services/auth/google_identity'

const TTL_MS = 15 * 60_000
const KEY = 'googleJoinIntentId'
const hash = (purpose: string, value: string) =>
  createHash('sha256')
    .update(`capacitylens-google-join:${purpose}\0`)
    .update(value)
    .digest('base64url')

type JoinPurpose = 'policy' | 'invitation'

export function parseGoogleJoinStart(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAdmission()
  const body = value as Record<string, unknown>
  if (
    Object.keys(body).some(
      (key) => !['providerId', 'purpose', 'email', 'invitationToken'].includes(key)
    ) ||
    body.providerId !== 'google' ||
    !['policy', 'invitation'].includes(String(body.purpose))
  )
    invalidAdmission()
  const email = typeof body.email === 'string' ? normalizeAccountEmail(body.email) : ''
  if (!isAccountEmail(email)) invalidAdmission('Invalid email address.')
  const invitationToken = body.invitationToken
  if (body.purpose === 'invitation' && typeof invitationToken !== 'string') invalidAdmission()
  if (body.purpose === 'policy' && invitationToken !== undefined) invalidAdmission()
  return {
    email,
    purpose: body.purpose as JoinPurpose,
    invitationToken: invitationToken as string | undefined,
  }
}

async function assertTarget(
  trx: TransactionClientContract,
  accountId: string,
  email: string,
  purpose: JoinPurpose,
  invitationId: string | null
) {
  const account = await trx.from('accounts').where('id', accountId).first()
  if (!account) missingAdmission('Company not found.')
  const settings = await readJoiningPolicy(trx, accountId)
  if (
    !policyAllowsAdmission({
      settings,
      email,
      hasCurrentProof: true,
      invitation: purpose === 'invitation' ? 'addressed' : 'none',
    })
  )
    forbiddenAdmission('Company joining policy changed.')
  if (purpose === 'invitation') {
    const invite = await trx
      .from('invitations')
      .where({ id: invitationId, account_id: accountId, email, accepted_at: null })
      .where('expires_at', '>', new Date().toISOString())
      .first()
    if (!invite) conflictingAdmission('Invitation changed.')
  }
  const restriction = await trx
    .from('account_access_restrictions')
    .where({ account_id: accountId, verified_email: email })
    .first()
  if (restriction) forbiddenAdmission('Company access requires administrator restoration.')
  return account
}

/** Stores only a digest of OAuth state and binds company selection to this browser session. */
export async function startGoogleJoin(
  trx: TransactionClientContract,
  ctx: HttpContext,
  accountId: string,
  input: ReturnType<typeof parseGoogleJoinStart>,
  state: string
) {
  let invitationId: string | null = null
  if (input.purpose === 'invitation') {
    const invite = await lookupInvitation(trx, input.invitationToken!)
    if (invite.account_id !== accountId || invite.email !== input.email)
      forbiddenAdmission('Invitation does not match this company and address.')
    invitationId = String(invite.id)
  }
  await assertTarget(trx, accountId, input.email, input.purpose, invitationId)
  const previousId: unknown = ctx.session.get(KEY)
  if (typeof previousId === 'string')
    await trx
      .from('company_join_intents')
      .where({ id: previousId, state: 'started' })
      .update({ state: 'cancelled', updated_at: new Date().toISOString() })
  const now = Date.now()
  const id = randomUUID()
  await trx.table('company_join_intents').insert({
    id,
    nonce_hash: hash('nonce', randomBytes(32).toString('base64url')),
    browser_hash: hash('browser', ctx.session.sessionId),
    purpose: input.purpose,
    account_id: accountId,
    invitation_id: invitationId,
    email: input.email,
    principal_id: null,
    provider_id: 'google',
    state: 'started',
    token_hash: null,
    delivery_generation: 0,
    expires_at: now + TTL_MS,
    sent_count: 0,
    last_sent_at: null,
    source_ip_hash: hash('ip', ctx.request.ip()),
    provider_state_hash: hash('state', state),
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  })
  ctx.session.put(KEY, id)
  return { url: '', emailHint: `${input.email.slice(0, input.email.lastIndexOf('@'))}@…` }
}

function currentJoinId(ctx: HttpContext) {
  const id: unknown = ctx.session.get(KEY)
  return typeof id === 'string' ? id : null
}

export async function readGoogleJoin(ctx: HttpContext, trx: TransactionClientContract) {
  const id = currentJoinId(ctx)
  return id ? trx.from('company_join_intents').where('id', id).first() : null
}

/** Rechecks the exact browser, OAuth state, verified address and live target before admission. */
export async function assertGoogleJoinCallback(
  trx: TransactionClientContract,
  ctx: HttpContext,
  state: string,
  profile: VerifiedGoogleProfile
) {
  const row = await readGoogleJoin(ctx, trx)
  if (
    !row ||
    row.state !== 'started' ||
    Number(row.expires_at) <= Date.now() ||
    row.provider_id !== 'google' ||
    row.browser_hash !== hash('browser', ctx.session.sessionId) ||
    row.provider_state_hash !== hash('state', state)
  )
    forbiddenAdmission('Company join expired.')
  if (row.email !== profile.email)
    forbiddenAdmission('Google address does not match the company join.')
  await assertTarget(
    trx,
    String(row.account_id),
    profile.email,
    row.purpose as JoinPurpose,
    row.invitation_id ? String(row.invitation_id) : null
  )
  const existing = await trx
    .from('provider_identities')
    .where({ provider: 'google', issuer: 'https://accounts.google.com', subject: profile.subject })
    .first()
  if (!existing && row.purpose !== 'invitation')
    forbiddenAdmission('A new Google identity requires an addressed invitation.')
  return row
}

export async function approveGoogleJoin(
  trx: TransactionClientContract,
  id: string,
  userId: string
) {
  const changed = await trx
    .from('company_join_intents')
    .where({ id, state: 'started' })
    .where('expires_at', '>', Date.now())
    .update({ state: 'approved', principal_id: userId, updated_at: new Date().toISOString() })
  if (affectedRows(changed) !== 1) conflictingAdmission('Company join expired.')
}

export async function googleJoinStatus(ctx: HttpContext, trx: TransactionClientContract) {
  const row = await readGoogleJoin(ctx, trx)
  if (
    !row ||
    Number(row.expires_at) <= Date.now() ||
    !['started', 'approved'].includes(String(row.state))
  )
    return { state: 'expired' as const }
  const email = String(row.email)
  return {
    state: row.state === 'approved' ? ('approved' as const) : ('pending' as const),
    accountId: row.account_id,
    purpose: row.purpose,
    providerId: 'google',
    email,
    emailHint: `${email.slice(0, email.lastIndexOf('@'))}@…`,
    deliveryUnavailable: false,
  }
}

export async function cancelGoogleJoin(ctx: HttpContext, trx: TransactionClientContract) {
  const id = currentJoinId(ctx)
  if (id)
    await trx
      .from('company_join_intents')
      .where('id', id)
      .whereIn('state', ['started', 'approved'])
      .update({ state: 'cancelled', updated_at: new Date().toISOString() })
  ctx.session.forget(KEY)
}

/** Makes membership and any invitation consumption one command transaction. */
export async function completeGoogleJoin(
  ctx: HttpContext,
  invitationToken: string | undefined,
  trx: TransactionClientContract
) {
  const actor = await resolveCurrentActor(ctx, trx)
  if (ctx.session.get('authenticationProvider') !== 'google')
    forbiddenAdmission('Sign in with Google to complete joining.')
  const row = await readGoogleJoin(ctx, trx)
  if (!row || row.principal_id !== actor.userId) conflictingAdmission('Company join expired.')
  const accountId = String(row.account_id)
  const email = String(row.email)
  if (actor.user.email !== email || !(await hasCurrentEmailProof(trx, actor.userId, email)))
    forbiddenAdmission('Current Google address proof is required.')
  const restricted = await trx
    .from('account_access_restrictions')
    .where('account_id', accountId)
    .andWhere((query) => query.where('principal_id', actor.userId).orWhere('verified_email', email))
    .first()
  if (restricted) forbiddenAdmission('Company access requires administrator restoration.')
  if (row.purpose === 'invitation' && invitationToken !== undefined) {
    const bound = await findInvitationByToken(trx, invitationToken)
    if (bound.id !== row.invitation_id) conflictingAdmission('Invitation changed.')
  } else if (invitationToken !== undefined) invalidAdmission()
  const command = readAccountCommand(ctx)
  const input = {
    actorId: actor.userId,
    accountId,
    operation: 'complete-provider-join',
    payload: { intentId: row.id },
    command,
    kind: 'semantic' as const,
  }
  const prior = await readCompletedAccountCommand(trx, input)
  if (prior?.replayed) {
    const member = await trx
      .from('memberships')
      .where({ account_id: accountId, user_id: actor.userId, status: 'active' })
      .first()
    if (row.state !== 'completed' || !member)
      forbiddenAdmission('Current company access is required.')
    return prior.result
  }
  if (row.state !== 'approved' || Number(row.expires_at) <= Date.now())
    conflictingAdmission('Company join expired.')
  await assertTarget(
    trx,
    accountId,
    email,
    row.purpose as JoinPurpose,
    row.invitation_id ? String(row.invitation_id) : null
  )
  const claim = await claimAccountCommand(trx, input)
  if (claim.replayed) return claim.result
  let result: { accountId: string; role: string }
  if (row.purpose === 'invitation') {
    const invite = invitationToken
      ? await lookupInvitation(trx, invitationToken)
      : await trx
          .from('invitations')
          .where({ id: row.invitation_id, account_id: accountId, email, accepted_at: null })
          .where('expires_at', '>', new Date().toISOString())
          .first()
    if (!invite || !['viewer', 'editor', 'admin'].includes(String(invite.role)))
      conflictingAdmission('Invitation changed.')
    result = await acceptInvitation(trx, invite, actor.userId, email)
  } else {
    const member = await trx
      .from('memberships')
      .where({ account_id: accountId, user_id: actor.userId })
      .first()
    if (member?.status === 'disabled')
      forbiddenAdmission('Company access requires administrator restoration.')
    const role = member?.status === 'active' ? String(member.role) : 'viewer'
    const now = new Date().toISOString()
    if (!member)
      await trx.table('memberships').insert({
        id: randomUUID(),
        account_id: accountId,
        user_id: actor.userId,
        role,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
    else if (member.status === 'archived')
      await trx
        .from('memberships')
        .where('id', member.id)
        .update({ status: 'active', role, updated_at: now })
    if (!member || member.status === 'archived') {
      await advancePlanningRevision(trx, accountId)
      await trx.from('password_reset_tokens').where('tokenable_id', actor.userId).delete()
      await writeAudit(trx, {
        accountId,
        actorId: actor.userId,
        action: 'membership.joined',
        entity: 'membership',
        entityId: actor.userId,
        fields: ['role', 'status'],
      })
    }
    result = { accountId, role }
  }
  await confirmMemberSignIn(accountId, actor.userId, trx)
  await trx
    .from('company_join_intents')
    .where({ id: row.id, state: 'approved' })
    .update({ state: 'completed', updated_at: new Date().toISOString() })
  await completeAccountCommand(trx, command.commandId, result)
  return result
}
