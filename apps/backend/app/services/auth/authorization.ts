import db from '@adonisjs/lucid/services/db';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { actionPermission } from '@capacitylens/shared/account/permissions';
import { isAccountRole, type Role } from '@capacitylens/shared/account/types';
import type { Action } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { actorIn } from '#services/auth/current_actor';
import { forbiddenAdmission } from '#services/admission/errors';

/** A transaction, or none where a Kit callback supplies none; raw reads then use the default connection. */
type Reader = TransactionClientContract | undefined;

export class IdentityAuthorityError extends Error {
  code = 'IDENTITY_AUTHORITY_DENIED';
  status = 403;
}

/** A stored role outside the product vocabulary is corruption: a server fault, never a 403. */
export class MembershipStorageError extends Error {
  code = 'MEMBERSHIP_STORAGE_CORRUPT';
}

function role(value: unknown): Role {
  if (!isAccountRole(value)) throw new MembershipStorageError('Stored membership role is invalid.');
  return value;
}

/** Restricts a principal directly or by its confirmed address, which outlives a re-created identity. */
export async function restrictedCompanyIds(userId: string, trx: Reader) {
  const proof = await (trx ?? db)
    .from('users')
    .where('id', userId)
    .whereNotNull('email_verified_at')
    .whereNull('unverified_email')
    .select('email')
    .first();
  const rows = await (trx ?? db)
    .from('account_access_restrictions')
    .where((query) => {
      // These clauses configure the enclosing awaited query.
      void query.where('principal_id', userId);
      if (proof) void query.orWhere('verified_email', String(proof.email));
    })
    .select('account_id');
  return new Set(rows.map((row) => String(row.account_id)));
}

/** Refuses a new membership in a company that restricted this principal or its confirmed address. */
export async function assertCompanyAccessOpen(userId: string, accountId: string, trx: Reader) {
  const restricted = await restrictedCompanyIds(userId, trx);
  if (restricted.has(accountId)) {
    forbiddenAdmission('Company access requires administrator restoration.');
  }
}

async function memberRoles(userId: string, trx: Reader, activeOnly: boolean) {
  const list = await access.memberships.listForUser(userId, trx);
  const restricted = activeOnly ? await restrictedCompanyIds(userId, trx) : new Set<string>();
  return new Map(
    list
      .filter((m) => (activeOnly ? m.status === 'active' : true))
      .filter((m) => !restricted.has(String(m.scopeId)))
      .map((m) => [String(m.scopeId), role(m.role)])
  );
}

/** Checks identity-wide standing from transaction-current memberships before cross-user security changes. */
export async function assertMayAdministerTarget(
  actorUserId: string,
  targetUserId: string,
  trx: TransactionClientContract
) {
  const [actorRoles, targetRoles] = await Promise.all([
    memberRoles(actorUserId, trx, true),
    memberRoles(targetUserId, trx, false),
  ]);
  if (!access.canAdministerIdentity(actorRoles, targetRoles, actorUserId === targetUserId)) {
    throw new IdentityAuthorityError('You cannot administer this identity.');
  }
}

/** Resolves active company standing for ordinary data and member policies. */
export async function activeCompanyRole(
  actorUserId: string,
  accountId: string,
  trx: Reader
): Promise<Role | null> {
  const m = await access.memberships.find(accountId, actorUserId, trx);
  if (!m || m.status !== 'active') return null;
  const restricted = await restrictedCompanyIds(actorUserId, trx);
  if (restricted.has(accountId)) return null;
  return role(m.role);
}

/** Authorizes one company action from live membership inside the actor's verified transaction. */
export async function assertCompanyAction(
  accountId: string,
  action: Action,
  trx: TransactionClientContract
): Promise<{ actorId: string; role: Role }> {
  const actor = actorIn(trx);
  const memberRole = await activeCompanyRole(actor.userId, accountId, trx);
  if (!memberRole || !access.can(memberRole, actionPermission[action])) {
    throw new IdentityAuthorityError('Forbidden.');
  }
  return { actorId: actor.userId, role: memberRole };
}
