import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  isApprovedEmailDomain,
  parseApprovedDomains,
} from '@capacitylens/shared/account/approvedDomains'
import { isJoiningPolicy, type JoiningPolicySettings } from '@capacitylens/shared/account/types'
import { forbiddenAdmission, invalidAdmission } from './errors.js'
import { advancePlanningRevision } from '#services/planning_revision'

const DEFAULT_POLICY: JoiningPolicySettings = { policy: 'invitation_only', approvedDomains: [] }

/** Validates the exact company admission setting before a transactional write. */
export function parseJoiningPolicy(value: unknown): JoiningPolicySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAdmission()
  const body = value as Record<string, unknown>
  if (Object.keys(body).some((key) => key !== 'policy' && key !== 'approvedDomains'))
    invalidAdmission()
  if (!isJoiningPolicy(body.policy)) invalidAdmission('Invalid joining policy.')
  const approvedDomains = parseApprovedDomains(body.approvedDomains)
  if (!approvedDomains) invalidAdmission('Invalid approved domains.')
  if (
    (body.policy === 'approved_domains' || body.policy === 'approved_domains_or_invitation') &&
    approvedDomains.length === 0
  )
    invalidAdmission('At least one approved domain is required.')
  return { policy: body.policy, approvedDomains }
}

/** Reads the company policy on the caller's transaction, defaulting to invitation-only. */
export async function readJoiningPolicy(
  trx: TransactionClientContract,
  accountId: string
): Promise<JoiningPolicySettings> {
  const row = await trx.from('account_joining_policies').where('account_id', accountId).first()
  if (!row) return DEFAULT_POLICY
  const domains: unknown = JSON.parse(String(row.approved_domains))
  const approvedDomains = parseApprovedDomains(domains)
  if (!isJoiningPolicy(row.policy) || !approvedDomains)
    forbiddenAdmission('Company joining policy is unavailable.')
  return { policy: row.policy, approvedDomains }
}

/** Persists the current policy within the caller's command transaction. */
export async function writeJoiningPolicy(
  trx: TransactionClientContract,
  accountId: string,
  settings: JoiningPolicySettings
) {
  const current = await readJoiningPolicy(trx, accountId)
  if (
    current.policy === settings.policy &&
    JSON.stringify(current.approvedDomains) === JSON.stringify(settings.approvedDomains)
  )
    return false
  const now = new Date().toISOString()
  await trx
    .table('account_joining_policies')
    .insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      policy: settings.policy,
      approved_domains: JSON.stringify(settings.approvedDomains),
      created_at: now,
      updated_at: now,
    })
    .onConflict('account_id')
    .merge(['policy', 'approved_domains', 'updated_at'])
  await advancePlanningRevision(trx, accountId)
  return true
}

/** Evaluates one admission from current trusted mailbox evidence. */
export function policyAllowsAdmission(input: {
  settings: JoiningPolicySettings
  email: string
  hasCurrentProof: boolean
  invitation: 'none' | 'link' | 'addressed'
}): boolean {
  const { settings, email, hasCurrentProof, invitation } = input
  if (settings.policy === 'invitation_only') return invitation !== 'none'
  if (invitation === 'addressed' && settings.policy !== 'approved_domains') return true
  if (!hasCurrentProof) return false
  if (settings.policy === 'open') return true
  const domain = isApprovedEmailDomain(email, settings.approvedDomains)
  if (settings.policy === 'approved_domains') return domain
  return domain || invitation !== 'none'
}

/** Checks a stored same-address proof rather than a legacy boolean or request body. */
export async function hasCurrentEmailProof(
  trx: TransactionClientContract,
  userId: string,
  email: string
): Promise<boolean> {
  const user = await trx.from('users').where({ id: userId, email }).select('email_verified').first()
  if (!user?.email_verified) return false
  const proof = await trx
    .from('email_proofs')
    .where({ user_id: userId, email })
    .whereNotNull('verified_at')
    .first()
  return Boolean(proof)
}
