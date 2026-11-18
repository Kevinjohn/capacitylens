import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { conflictingAdmission } from '#services/admission/errors';
import access from '#config/access_control';
import { getActiveMembership } from '#services/auth/authorization';
import { affectedRows } from '#services/affected_rows';
import { advancePlanningRevision } from '#services/planning_revision';
import { writeAudit } from '#services/audit';

type Trx = TransactionClientContract;

async function currentLink(trx: Trx, companyId: string, userId: string) {
  return trx
    .from('account_member_resources')
    .where({ company_id: companyId, user_id: userId })
    .first();
}

async function assertEligibleMember(trx: Trx, companyId: string, userId: string) {
  if (!(await getActiveMembership(userId, companyId, trx))) {
    conflictingAdmission('Only an active company member can be linked.');
  }
}

async function resource(trx: Trx, companyId: string, resourceId: string) {
  return trx.from('resources').where({ company_id: companyId, id: resourceId }).first();
}

/** Checks the scheduled person is still available to link. */
async function assertAvailablePerson(trx: Trx, companyId: string, resourceId: string) {
  const row = await resource(trx, companyId, resourceId);
  if (row?.kind !== 'person' || row.archived_at || row.deleted_at) {
    conflictingAdmission('The selected scheduled person is no longer available.');
  }
}

/** Applies a CAS member/person association within the caller's product transaction. */
export async function setMemberResourceLink(
  trx: Trx,
  input: {
    companyId: string;
    userId: string;
    resourceId: string;
    expectedRevision: string | null;
    actorId: string;
    now?: string;
  }
) {
  const { companyId, userId, resourceId, expectedRevision, actorId } = input;
  const now = input.now ?? new Date().toISOString();
  await assertEligibleMember(trx, companyId, userId);
  await assertAvailablePerson(trx, companyId, resourceId);
  const current = await currentLink(trx, companyId, userId);
  if ((current?.revision ?? null) !== expectedRevision) {
    conflictingAdmission('The member resource link changed. Refresh and retry.');
  }
  if (current && current.resource_id !== resourceId) {
    const previous = await resource(trx, companyId, String(current.resource_id));
    if (previous?.kind !== 'person' || previous.archived_at || previous.deleted_at) {
      conflictingAdmission(
        'The current scheduled person is unavailable; unlink it before changing the link.'
      );
    }
  }
  const occupied = await trx
    .from('account_member_resources')
    .where({ company_id: companyId, resource_id: resourceId })
    .first();
  if (occupied && occupied.user_id !== userId) {
    conflictingAdmission('That scheduled person is already linked to another member.');
  }
  if (current?.resource_id === resourceId) {
    return { resourceId, revision: String(current.revision), changed: false };
  }
  const revision = crypto.randomUUID();
  if (current) {
    await trx
      .from('account_member_resources')
      .where({ company_id: companyId, user_id: userId, revision: expectedRevision })
      .update({ resource_id: resourceId, revision, updated_at: now });
  } else {
    await trx.table('account_member_resources').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      user_id: userId,
      resource_id: resourceId,
      revision,
      created_at: now,
      updated_at: now,
    });
  }
  await advancePlanningRevision(trx, companyId);
  await writeAudit(
    trx,
    {
      companyId,
      actorId,
      action: 'member-resource.linked',
      entity: 'membership',
      entityId: userId,
      fields: ['resourceLink'],
    },
    now
  );
  return { resourceId, revision, changed: true };
}

/** Clears a member/person association only at the expected revision. */
export async function clearMemberResourceLink(
  trx: Trx,
  input: { companyId: string; userId: string; expectedRevision: string; actorId: string }
) {
  const { companyId, userId, expectedRevision, actorId } = input;
  const member = await access.memberships.find(companyId, userId, trx);
  if (!member) conflictingAdmission('The company member no longer exists.');
  const changed = await trx
    .from('account_member_resources')
    .where({ company_id: companyId, user_id: userId, revision: expectedRevision })
    .delete();
  if (affectedRows(changed) !== 1) {
    conflictingAdmission('The member resource link changed. Refresh and retry.');
  }
  await advancePlanningRevision(trx, companyId);
  await writeAudit(trx, {
    companyId,
    actorId,
    action: 'member-resource.unlinked',
    entity: 'membership',
    entityId: userId,
    fields: ['resourceLink'],
  });
}
