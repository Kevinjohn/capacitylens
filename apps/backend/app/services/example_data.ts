import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { buildExampleCompany, countExampleRows } from '@capacitylens/shared/data/exampleCompany';
import logger from '@adonisjs/core/services/logger';
import { resolveCalendarToday } from '@capacitylens/shared/lib/calendarToday';
import { encodeRow, readStateWithClient } from '#services/state_repository';
import { tables } from '#services/product_tables';
import { writeAudit } from '#services/audit';
import { EntityWriteError } from '#services/planning/errors';
import { advancePlanningRevision } from '#services/planning_revision';

const INSERT_ORDER = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'timeOff',
] as const;

/**
 * Adds the example company's rows to a company that has no people, clients, projects or
 * allocations, records the audit entry and advances the planning revision. Returns the row count.
 */
export async function addExampleData(
  trx: TransactionClientContract,
  companyId: string,
  actorId: string
) {
  const state = await readStateWithClient(trx, companyId, true);
  const account = state.accounts.at(0);
  if (!account) throw new EntityWriteError('Company not found.', 404);
  if (
    state.resources.length > 0 ||
    state.clients.some((client) => client.builtin !== true) ||
    state.projects.length > 0 ||
    state.allocations.length > 0
  ) {
    throw new EntityWriteError(
      'Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.',
      409,
      undefined,
      'EXAMPLE_DATA_COMPANY_NOT_EMPTY'
    );
  }
  const today = resolveCalendarToday(account.timezone ?? undefined);
  if (today.kind === 'invalid-time-zone') {
    // The example still lands around the server's local date; the operator log names the zone.
    logger.warn(
      { timeZone: today.timeZone, err: today.cause },
      'Example data used the local date because the company time zone is invalid'
    );
  }
  const sample = buildExampleCompany({
    companyId,
    referenceDate: today.date,
    weekStartsOn: account.weekStartsOn ?? 1,
  });
  for (const key of INSERT_ORDER) {
    const rows = sample[key];
    if (rows.length > 0) {
      await trx
        .table(tables[key])
        .multiInsert(
          rows.map((row) => encodeRow(tables[key], row as unknown as Record<string, unknown>))
        );
    }
  }
  await writeAudit(trx, {
    companyId,
    actorId,
    action: 'exampleData',
    entity: 'account',
    entityId: companyId,
    fields: Object.keys(sample),
  });
  await advancePlanningRevision(trx, companyId);
  return countExampleRows(sample);
}
