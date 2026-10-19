import { newId } from '@capacitylens/shared/lib/id'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { restrictedCompanyIds } from '#services/auth/authorization'

const TRACKING_KEY = 'member-sign-in-tracking'
const observedKey = (userId: string) => `member-sign-in:${userId}`

function enabled(value: unknown) {
  return value === true || value === 'true' || value === '"true"'
}

/** Reads a company's private Boolean tracking window without exposing sign-in times. */
export async function readMemberSignInTracking(accountId: string, trx: TransactionClientContract) {
  const setting = await trx
    .from('company_settings')
    .where({ account_id: accountId, key: TRACKING_KEY })
    .first()
  if (!setting || !enabled(setting.value))
    return { enabled: false, confirmations: new Set<string>() }
  const observed = await trx
    .from('company_settings')
    .where('account_id', accountId)
    .where('key', 'like', 'member-sign-in:%')
    .select('key')
  return {
    enabled: true,
    confirmations: new Set(observed.map((row) => String(row.key).slice('member-sign-in:'.length))),
  }
}

/** Enables a new observation window or erases every observation when disabled. */
export async function setMemberSignInTracking(
  accountId: string,
  active: boolean,
  trx: TransactionClientContract
) {
  const current = await readMemberSignInTracking(accountId, trx)
  if (current.enabled === active) return
  if (!active) {
    await trx
      .from('company_settings')
      .where('account_id', accountId)
      .where((query) => query.where('key', TRACKING_KEY).orWhere('key', 'like', 'member-sign-in:%'))
      .delete()
    return
  }
  const now = new Date().toISOString()
  await trx.table('company_settings').insert({
    id: newId(),
    account_id: accountId,
    key: TRACKING_KEY,
    value: JSON.stringify(true),
    created_at: now,
    updated_at: now,
  })
}

/** Records a proven sign-in only for active memberships in enabled windows. */
export async function recordMemberSignIn(userId: string, trx: TransactionClientContract) {
  const accounts = await trx
    .from('memberships')
    .where({ user_id: userId, status: 'active' })
    .select('account_id')
  const now = new Date().toISOString()
  for (const row of accounts) {
    const accountId = String(row.account_id)
    await confirmMemberSignIn(accountId, userId, trx, now)
  }
}

/** Confirms an already signed-in Owner in only the window they just enabled. */
export async function confirmMemberSignIn(
  accountId: string,
  userId: string,
  trx: TransactionClientContract,
  now = new Date().toISOString()
) {
  const setting = await trx
    .from('company_settings')
    .where({ account_id: accountId, key: TRACKING_KEY })
    .first()
  if (!setting || !enabled(setting.value)) return
  const activeMember = await trx
    .from('memberships')
    .where({ account_id: accountId, user_id: userId, status: 'active' })
    .first()
  if (!activeMember) return
  const restricted = await restrictedCompanyIds(userId, trx)
  if (restricted.has(accountId)) return
  await trx
    .table('company_settings')
    .insert({
      id: newId(),
      account_id: accountId,
      key: observedKey(userId),
      value: JSON.stringify(true),
      created_at: now,
      updated_at: now,
    })
    .onConflict(['account_id', 'key'])
    .ignore()
}

/** Clears one member's observation when company access changes. */
export async function resetMemberSignIn(
  accountId: string,
  userId: string,
  trx: TransactionClientContract
) {
  await trx
    .from('company_settings')
    .where({ account_id: accountId, key: observedKey(userId) })
    .delete()
}

/** Clears an identity's observations when all-user session authority is revoked. */
export async function clearMemberSignIn(userId: string, trx: TransactionClientContract) {
  await trx.from('company_settings').where('key', observedKey(userId)).delete()
}
