import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { refuseConflictingAdmission } from '#exceptions/admission_errors';
import access from '#config/access_control';
import { AuthorizationService } from '#services/auth/authorization_service';
import { parseAffectedRows } from '#models_support/affected_rows';
import { AuditService } from '#services/audit_service';
import { PlanningRevisionService } from '#services/planning_revision_service';
import Resource from '#models/resource';

type Trx = TransactionClientContract;

async function getCurrentLink(trx: Trx, companyId: string, userId: string) {
  return trx
    .from('account_member_resources')
    .where({ company_id: companyId, user_id: userId })
    .first();
}

async function getResource(trx: Trx, companyId: string, resourceId: string) {
  return Resource.query({ client: trx })
    .withScopes((scopes) => scopes.forCompany(companyId))
    .where('id', resourceId)
    .first();
}

/** Checks the scheduled person is still available to link. */
async function assertAvailablePerson(trx: Trx, companyId: string, resourceId: string) {
  const row = await getResource(trx, companyId, resourceId);
  if (row?.kind !== 'person' || row.archivedAt) {
    refuseConflictingAdmission('The selected scheduled person is no longer available.');
  }
}

/** Links a company member to the scheduled person who represents them. */
@inject()
export class MemberResourceLinkService {
  #authorization: AuthorizationService;
  #audit: AuditService;
  #planningRevisions: PlanningRevisionService;

  constructor(
    authorization: AuthorizationService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService
  ) {
    this.#authorization = authorization;
    this.#audit = audit;
    this.#planningRevisions = planningRevisions;
  }

  async #assertEligibleMember(trx: Trx, companyId: string, userId: string) {
    if (!(await this.#authorization.getActiveMembership(userId, companyId, trx))) {
      refuseConflictingAdmission('Only an active company member can be linked.');
    }
  }

  /** Applies a CAS member/person association within the caller's product transaction. */
  async set(
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
    await this.#assertEligibleMember(trx, companyId, userId);
    await assertAvailablePerson(trx, companyId, resourceId);
    const current = await getCurrentLink(trx, companyId, userId);
    if ((current?.revision ?? null) !== expectedRevision) {
      refuseConflictingAdmission('The member resource link changed. Refresh and retry.');
    }
    if (current && current.resource_id !== resourceId) {
      const previous = await getResource(trx, companyId, String(current.resource_id));
      if (previous?.kind !== 'person' || previous.archivedAt) {
        refuseConflictingAdmission(
          'The current scheduled person is unavailable; unlink it before changing the link.'
        );
      }
    }
    const occupied = await trx
      .from('account_member_resources')
      .where({ company_id: companyId, resource_id: resourceId })
      .first();
    if (occupied && occupied.user_id !== userId) {
      refuseConflictingAdmission('That scheduled person is already linked to another member.');
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
    await this.#planningRevisions.advancePlanningRevision(trx, companyId);
    await this.#audit.writeAudit(
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
  async clear(
    trx: Trx,
    input: { companyId: string; userId: string; expectedRevision: string; actorId: string }
  ) {
    const { companyId, userId, expectedRevision, actorId } = input;
    const member = await access.memberships.find(companyId, userId, trx);
    if (!member) refuseConflictingAdmission('The company member no longer exists.');
    const changed = await trx
      .from('account_member_resources')
      .where({ company_id: companyId, user_id: userId, revision: expectedRevision })
      .delete();
    if (parseAffectedRows(changed) !== 1) {
      refuseConflictingAdmission('The member resource link changed. Refresh and retry.');
    }
    await this.#planningRevisions.advancePlanningRevision(trx, companyId);
    await this.#audit.writeAudit(trx, {
      companyId,
      actorId,
      action: 'member-resource.unlinked',
      entity: 'membership',
      entityId: userId,
      fields: ['resourceLink'],
    });
  }
}
