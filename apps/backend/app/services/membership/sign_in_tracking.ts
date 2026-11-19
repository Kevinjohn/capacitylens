import { createId } from '@capacitylens/shared/lib/id';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { listActiveCompanyIds, getActiveMembership } from '#services/auth/authorization';
import { writeAudit } from '#services/audit';

const TRACKING_KEY = 'member-sign-in-tracking';
const buildObservedKey = (userId: string) => `member-sign-in:${userId}`;

function isEnabled(value: unknown) {
  return value === true || value === 'true' || value === '"true"';
}

/** Reads a company's private Boolean tracking window without exposing sign-in times. */
export async function readMemberSignInTracking(companyId: string, trx: TransactionClientContract) {
  const setting = await trx
    .from('company_settings')
    .where({ company_id: companyId, key: TRACKING_KEY })
    .first();
  if (!setting || !isEnabled(setting.value)) {
    return { enabled: false, confirmations: new Set<string>() };
  }
  const observed = await trx
    .from('company_settings')
    .where('company_id', companyId)
    .where('key', 'like', 'member-sign-in:%')
    .select('key');
  return {
    enabled: true,
    confirmations: new Set(observed.map((row) => String(row.key).slice('member-sign-in:'.length))),
  };
}

/** Enables a new observation window or erases every observation when disabled. */
export async function setMemberSignInTracking(
  companyId: string,
  active: boolean,
  trx: TransactionClientContract,
  now = new Date().toISOString()
) {
  const current = await readMemberSignInTracking(companyId, trx);
  if (current.enabled === active) return;
  if (!active) {
    await trx
      .from('company_settings')
      .where('company_id', companyId)
      .where((query) => query.where('key', TRACKING_KEY).orWhere('key', 'like', 'member-sign-in:%'))
      .delete();
    return;
  }
  await trx.table('company_settings').insert({
    id: createId(),
    company_id: companyId,
    key: TRACKING_KEY,
    value: JSON.stringify(true),
    created_at: now,
    updated_at: now,
  });
}

/** Records a proven sign-in only for active memberships in enabled windows. */
export async function recordMemberSignIn(
  userId: string,
  trx: TransactionClientContract,
  now = new Date().toISOString()
) {
  for (const companyId of await listActiveCompanyIds(userId, trx)) {
    await confirmMemberSignIn(companyId, userId, trx, now);
  }
}

/**
 * Turns a company's sign-in tracking on or off for an authorized actor: an enabling Owner is
 * confirmed in the new window at once, and a change is audited.
 */
export async function changeMemberSignInTracking(
  trx: TransactionClientContract,
  input: { companyId: string; actorId: string; enabled: boolean; now?: string }
) {
  const { companyId, actorId, enabled: requested } = input;
  const now = input.now ?? new Date().toISOString();
  const current = await readMemberSignInTracking(companyId, trx);
  await setMemberSignInTracking(companyId, requested, trx, now);
  if (!current.enabled && requested) await confirmMemberSignIn(companyId, actorId, trx, now);
  if (current.enabled !== requested) {
    await writeAudit(
      trx,
      {
        companyId,
        actorId,
        action: 'memberSignInTrackingChange',
        entity: 'account',
        entityId: companyId,
        fields: ['memberSignInTracking'],
      },
      now
    );
  }
}

/** Confirms an already signed-in Owner in only the window they just enabled. */
export async function confirmMemberSignIn(
  companyId: string,
  userId: string,
  trx: TransactionClientContract,
  now = new Date().toISOString()
) {
  const setting = await trx
    .from('company_settings')
    .where({ company_id: companyId, key: TRACKING_KEY })
    .first();
  if (!setting || !isEnabled(setting.value)) return;
  if (!(await getActiveMembership(userId, companyId, trx))) return;
  await trx
    .table('company_settings')
    .insert({
      id: createId(),
      company_id: companyId,
      key: buildObservedKey(userId),
      value: JSON.stringify(true),
      created_at: now,
      updated_at: now,
    })
    .onConflict(['company_id', 'key'])
    .ignore();
}

/** Clears one member's observation when company access changes. */
export async function resetMemberSignIn(
  companyId: string,
  userId: string,
  trx: TransactionClientContract
) {
  await trx
    .from('company_settings')
    .where({ company_id: companyId, key: buildObservedKey(userId) })
    .delete();
}
