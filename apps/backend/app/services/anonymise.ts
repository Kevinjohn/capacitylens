import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { obfuscateResource } from '@capacitylens/shared/domain/lifecycle';
import type { Resource as ResourceRow } from '@capacitylens/shared/types/entities';
import Allocation from '#models/allocation';
import Resource from '#models/resource';
import TimeOff from '#models/time_off';
import { rowAttributes } from '#models_support/row_attributes';
import { readStateWithClient } from '#services/state_repository';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';
import { createServerRevision } from '#services/planning/server_timestamp';
import { discardRestorationGroups } from '#services/planning/restoration';
import { discardHistory } from '#services/planning/history';

/** Scrubs planning identity and saved undo images in the caller's transaction. */
export async function anonymiseResources(
  trx: TransactionClientContract,
  companyId: string,
  actorId: string,
  resourceId?: string
) {
  const state = await readStateWithClient(trx, companyId, true);
  const resources = resourceId
    ? state.resources.filter((resource) => resource.id === resourceId)
    : state.resources;
  if (resourceId && resources.length === 0) return false;
  const ids = resources.map((resource) => resource.id);
  const stored = new Map<string, Resource>();
  for (let start = 0; start < ids.length; start += 500) {
    const rows = await Resource.query({ client: trx })
      .withScopes((scopes) => scopes.forCompany(companyId))
      .whereIn('id', ids.slice(start, start + 500));
    for (const row of rows) stored.set(row.id, row);
  }
  for (const resource of resources) {
    const row = stored.get(resource.id);
    if (!row) throw new Error('An anonymised resource is missing from its company.');
    const scrubbed = obfuscateResource(resource as ResourceRow);
    await row
      .merge(
        rowAttributes(Resource, {
          ...scrubbed,
          avatarUrl: null,
          updatedAt: createServerRevision(resource.updatedAt),
        })
      )
      .save();
  }
  for (const model of [Allocation, TimeOff]) {
    for (let start = 0; start < ids.length; start += 500) {
      // Soft-deleted rows can be restored, so their notes are scrubbed too.
      const noted = await model
        .query({ client: trx })
        .withScopes((scopes) => scopes.forCompany(companyId))
        .withTrashed()
        .whereIn('resource_id', ids.slice(start, start + 500))
        .whereNotNull('note');
      for (const dependent of noted) {
        const revision = createServerRevision(dependent.updatedAt.toJSDate().toISOString());
        const { updatedAt } = rowAttributes(model, { updatedAt: revision });
        await dependent.merge({ note: null, updatedAt }).save();
      }
    }
  }
  await discardRestorationGroups(trx, companyId);
  await discardHistory(trx, companyId);
  await writeAudit(trx, {
    companyId,
    actorId,
    action: 'anonymise',
    entity: resourceId ? 'resources' : 'companies',
    entityId: resourceId ?? companyId,
    fields: ['name', 'jobTitle', 'avatarUrl', 'allocations.note', 'timeOff.note'],
  });
  await advancePlanningRevision(trx, companyId);
  return true;
}
