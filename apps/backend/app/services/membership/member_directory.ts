import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder';
import type { MemberActions } from '@capacitylens/shared/account/permissions';
import {
  isAccountRole,
  type MembershipStatus,
  type Role,
} from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { lifecycleOf, scopeMemberships, storedRole } from '#services/membership/package_projection';
import type { MemberResourceLinkProjection } from '#services/member_resources/directory';
import { readMemberSignInTracking } from '#services/membership/sign_in_tracking';
import {
  type MemberResourceFields,
  readMemberResourceFields,
  readResourceCandidates,
} from '#services/member_resources/directory';

interface PrincipalRow {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface RestrictedPrincipalDirectoryRow {
  principal_id: string;
  role: string;
  verified_email: string | null;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

/** A member or retained access restriction as returned by the company directory. */
export interface MemberDirectoryEntry {
  userId: string;
  role: Role;
  status: MembershipStatus;
  accessDisabled: boolean;
  membershipPresent: boolean;
  createdAt: string;
  name: string | null;
  email: string | null;
  signInConfirmed: boolean | null;
  isSelf: boolean;
  resourceLink: MemberResourceLinkProjection | null;
  actions: MemberActions;
}

interface MemberResourceCandidate {
  resourceId: string;
  label: string;
}

/** The full company-scoped membership directory response. */
export interface MemberDirectory {
  members: MemberDirectoryEntry[];
  signInTrackingEnabled: boolean;
  resourceCandidates: MemberResourceCandidate[];
}

/** Server-derived row controls for the actor; every operation is still authorized on its own. */
function memberActions(
  actorRole: Role,
  actorId: string,
  entry: Omit<MemberDirectoryEntry, 'actions'>
): MemberActions {
  const isSelf = entry.userId === actorId;
  const manage =
    entry.membershipPresent &&
    access.canManage({ actorRole, targetRole: entry.role, isSelf }).allowed;
  const assignable = access
    .assignableRoles(actorRole)
    .some(
      (next) =>
        next !== entry.role &&
        access.canAssign({ actorRole, targetRole: entry.role, nextRole: next, isSelf }).allowed
    );
  return {
    changeRole: manage && assignable && entry.status === 'active' && !entry.accessDisabled,
    changeStatus: manage,
    remove: manage,
    enableAccess:
      entry.accessDisabled &&
      !isSelf &&
      access.canManage({ actorRole, targetRole: entry.role, isSelf }).allowed,
    viewAs:
      !isSelf &&
      entry.membershipPresent &&
      entry.status === 'active' &&
      !entry.accessDisabled &&
      access.can(actorRole, 'viewAs:use'),
  };
}

/** Builds the member directory after the caller authorizes company member management. */
export async function readMemberDirectory(
  trx: TransactionClientContract,
  accountId: string,
  actor: { actorId: string; role: Role }
): Promise<MemberDirectory> {
  const { actorId } = actor;
  const restrictionQuery: DatabaseQueryBuilderContract<RestrictedPrincipalDirectoryRow> = trx
    .from('account_access_restrictions as restriction')
    .leftJoin('users as principal', 'principal.id', 'restriction.principal_id')
    .where('restriction.account_id', accountId)
    .select(
      'restriction.principal_id',
      'restriction.role',
      'restriction.verified_email',
      'restriction.created_at',
      'principal.display_name',
      'principal.email'
    )
    .orderBy('restriction.created_at', 'asc')
    .orderBy('restriction.principal_id', 'asc');
  const [memberships, restrictions, tracking, resourceCandidates] = await Promise.all([
    scopeMemberships(trx, actorId, accountId),
    restrictionQuery,
    readMemberSignInTracking(accountId, trx),
    readResourceCandidates(trx, accountId),
  ]);
  const denied = new Set(restrictions.map((row) => row.principal_id));
  const memberIds = new Set(memberships.map((m) => String(m.userId)));
  const principals: PrincipalRow[] = await trx
    .from('users')
    .whereIn('id', [...memberIds])
    .select('id', 'display_name', 'email');
  const principalById = new Map(principals.map((row) => [String(row.id), row]));
  const resourceFields = await readMemberResourceFields(trx, accountId, [...memberIds]);
  const members: MemberDirectoryEntry[] = [];
  for (const m of memberships) {
    const userId = String(m.userId);
    const principal = principalById.get(userId);
    // The lookup producer seeds every requested member ID before applying any links.
    const memberResourceFields = resourceFields.get(userId) as MemberResourceFields;
    // The package type trusts storage; a corrupt stored value is still possible.
    const storedStatus: string = m.status;
    if (storedStatus !== 'active' && storedStatus !== 'suspended') {
      throw new Error('Membership has an invalid status.');
    }
    const entry = {
      userId,
      role: storedRole(m),
      status: lifecycleOf(m),
      accessDisabled: denied.has(userId),
      membershipPresent: true,
      createdAt: m.createdAt.toUTC().toISO() as string,
      name: principal?.display_name ?? null,
      email: principal?.email ?? null,
      signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
      isSelf: actorId === userId,
      ...memberResourceFields,
    };
    members.push({ ...entry, actions: memberActions(actor.role, actorId, entry) });
  }
  for (const row of restrictions) {
    const userId = row.principal_id;
    if (memberIds.has(userId)) continue;
    if (!isAccountRole(row.role)) throw new Error('Access restriction has an invalid role.');
    const entry = {
      userId,
      role: row.role,
      status: 'disabled' as const,
      accessDisabled: true,
      membershipPresent: false,
      createdAt: row.created_at,
      name: row.display_name ?? null,
      email: row.email ?? row.verified_email ?? null,
      signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
      isSelf: actorId === userId,
      resourceLink: null,
    };
    members.push({ ...entry, actions: memberActions(actor.role, actorId, entry) });
  }
  return { members, signInTrackingEnabled: tracking.enabled, resourceCandidates };
}
