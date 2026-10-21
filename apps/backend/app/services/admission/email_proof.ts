import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { conflictingAdmission, forbiddenAdmission, invalidAdmission } from './errors.js'
import { affectedRows } from './affected_rows.js'
import { advanceRevisionsForNewEmailProof } from '#services/planning_revision'

const HOUR = 60 * 60 * 1000
const digest = (value: string) =>
  createHash('sha256').update('capacitylens-join-proof\0').update(value).digest('base64url')

/** Mints a one-hour, single-use mailbox proof bound to a real password session. */
export async function createEmailProofIntent(
  trx: TransactionClientContract,
  input: { accountId: string; userId: string; sessionId: string; email: string; sourceIp: string }
) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date().toISOString()
  const id = randomUUID()
  await trx.table('company_join_intents').insert({
    id,
    nonce_hash: digest(randomUUID()),
    browser_hash: digest(input.sessionId),
    purpose: 'policy',
    account_id: input.accountId,
    invitation_id: null,
    email: input.email,
    principal_id: input.userId,
    provider_id: 'password',
    state: 'mail-sent',
    token_hash: digest(token),
    delivery_generation: 1,
    expires_at: Date.now() + HOUR,
    sent_count: 1,
    last_sent_at: Date.now(),
    source_ip_hash: digest(input.sourceIp),
    provider_state_hash: digest(randomUUID()),
    created_at: now,
    updated_at: now,
  })
  return token
}

/** Consumes a mailbox token only for its original signed-in principal and session. */
export async function consumeEmailProofIntent(
  trx: TransactionClientContract,
  input: { token: string; userId: string; sessionId: string; email: string }
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) invalidAdmission('Invalid verification token.')
  const intent = await trx
    .from('company_join_intents')
    .where('token_hash', digest(input.token))
    .first()
  if (!intent || intent.state !== 'mail-sent' || Number(intent.expires_at) <= Date.now())
    invalidAdmission('Invalid verification token.')
  if (
    intent.principal_id !== input.userId ||
    intent.email !== input.email ||
    intent.browser_hash !== digest(input.sessionId)
  )
    forbiddenAdmission('Verification belongs to another session.')
  const ownerRestriction = await trx
    .from('memberships as member')
    .innerJoin(
      'account_access_restrictions as restriction',
      'restriction.account_id',
      'member.account_id'
    )
    .where({ 'member.user_id': input.userId, 'member.role': 'owner', 'member.status': 'active' })
    .andWhere((query) =>
      query
        .where('restriction.principal_id', input.userId)
        .orWhere('restriction.verified_email', input.email)
    )
    .first()
  if (ownerRestriction)
    forbiddenAdmission('This address cannot be verified while owner access is restricted.')
  const now = new Date().toISOString()
  const changed = await trx
    .from('company_join_intents')
    .where({ id: intent.id, state: 'mail-sent', token_hash: digest(input.token) })
    .update({ state: 'completed', token_hash: null, updated_at: now })
  if (affectedRows(changed) !== 1) conflictingAdmission('Verification link was used.')
  await advanceRevisionsForNewEmailProof(trx, input.userId, input.email)
  await trx
    .table('email_proofs')
    .insert({
      id: randomUUID(),
      user_id: input.userId,
      email: input.email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['user_id', 'email'])
    .merge(['verified_at', 'updated_at'])
  await trx
    .from('users')
    .where('id', input.userId)
    .update({ email_verified: true, updated_at: now })
}
