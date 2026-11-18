import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { obfuscateResource } from '@capacitylens/shared/domain/lifecycle';
import type { Resource } from '@capacitylens/shared/types/entities';
import { encodeRow, readStateWithClient } from '#services/state_repository';
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
  for (const resource of resources) {
    const scrubbed = obfuscateResource(resource as Resource);
    await trx
      .from('resources')
      .where({ id: resource.id, company_id: companyId })
      .update(
        encodeRow('resources', {
          ...scrubbed,
          avatarUrl: null,
          updatedAt: createServerRevision(resource.updatedAt),
        })
      );
  }
  const ids = resources.map((resource) => resource.id);
  for (const table of ['allocations', 'time_off'] as const) {
    for (let start = 0; start < ids.length; start += 500) {
      const noted = await trx
        .from(table)
        .select('id', 'updated_at')
        .where('company_id', companyId)
        .whereIn('resource_id', ids.slice(start, start + 500))
        .whereNotNull('note');
      for (const dependent of noted) {
        await trx
          .from(table)
          .where({ id: dependent.id, company_id: companyId })
          .update({ note: null, updated_at: createServerRevision(dependent.updated_at) });
      }
    }
  }
  await discardRestorationGroups(trx, companyId);
  await discardHistory(trx, companyId);
  await writeAudit(trx, {
    companyId,
    actorId,
    action: 'anonymise',
    entity: resourceId ? 'resources' : 'accounts',
    entityId: resourceId ?? companyId,
    fields: ['name', 'role', 'avatarUrl', 'allocations.note', 'timeOff.note'],
  });
  await advancePlanningRevision(trx, companyId);
  return true;
}
