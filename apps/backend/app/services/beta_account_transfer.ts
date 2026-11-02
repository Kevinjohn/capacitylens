import { createHash } from 'node:crypto';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  buildBetaExport,
  prepareBetaImport,
  type BetaExportDocument,
} from '@capacitylens/shared/data/betaTransfer';
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities';
import { encodeRow, readStateWithClient } from '#services/state_repository';
import { TABLE_NAMES } from '#services/planning_operations/entity_policy';
import { BatchRequestError } from '#services/planning_operations/errors';
import { getPlanningRevision, advancePlanningRevision } from '#services/planning_revision';
import { writeAudit } from '#services/audit';

const INSERT_ORDER = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'timeOff',
  'closures',
] as const;
const INSERT_CHUNK_SIZE = 32;
const ID_LOOKUP_CHUNK_SIZE = 200;

function fingerprint(data: AppData) {
  const rows = APP_DATA_KEYS.map((key) => [
    key,
    [...data[key]].sort((a, b) => a.id.localeCompare(b.id)),
  ]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function portableFingerprint(data: AppData, accountId: string) {
  return fingerprint(buildBetaExport(data, { accountId, completeness: 'full' }).data);
}

// Scheduling IDs are primary keys across every company, so a document exported from another
// company on this server cannot be inserted while that company still holds the same rows. Refusing
// here keeps preview and apply in agreement instead of surfacing a constraint failure after the
// Owner has confirmed with a password.
async function assertNoForeignIdCollision(
  trx: TransactionClientContract,
  accountId: string,
  data: AppData
) {
  for (const key of INSERT_ORDER) {
    const ids = data[key].map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK_SIZE) {
      const foreign = await trx
        .from(TABLE_NAMES[key])
        .whereIn('id', ids.slice(offset, offset + ID_LOOKUP_CHUNK_SIZE))
        .whereNot('account_id', accountId)
        .select('id')
        .first();
      if (foreign) {
        throw new BatchRequestError(
          'The import contains scheduling IDs used by another company on this server.',
          409,
          undefined,
          'IMPORT_ID_COLLISION'
        );
      }
    }
  }
}

async function context(trx: TransactionClientContract, accountId: string) {
  const links = await trx
    .from('account_member_resources')
    .where('account_id', accountId)
    .select('user_id', 'resource_id');
  return {
    accountId,
    memberResourceLinks: links.map((link) => ({
      memberId: String(link.user_id),
      resourceId: String(link.resource_id),
    })),
  };
}

/** Validates one full document against current company links and returns its visible impact. */
export async function previewBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument
) {
  const current = await readStateWithClient(trx, accountId, true);
  if (current.accounts.length !== 1) throw new BatchRequestError('Company not found.', 404);
  const prepared = prepareBetaImport(document, await context(trx, accountId));
  await assertNoForeignIdCollision(trx, accountId, prepared.data);
  const changed = portableFingerprint(current, accountId) !== fingerprint(prepared.data);
  const baseRevision = await getPlanningRevision(trx, accountId);
  return { baseRevision, imported: prepared.imported, changed };
}

/** Replaces the company slice with stable IDs; the caller owns authorization and proof consumption. */
export async function applyBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument,
  baseRevision: number,
  actorId: string
) {
  const current = await readStateWithClient(trx, accountId, true);
  if (current.accounts.length !== 1) throw new BatchRequestError('Company not found.', 404);
  const revision = await getPlanningRevision(trx, accountId);
  if (revision !== baseRevision) {
    throw new BatchRequestError(
      'The company changed. Preview the current data again.',
      409,
      { revision },
      'IMPORT_SNAPSHOT_STALE'
    );
  }
  const prepared = prepareBetaImport(document, await context(trx, accountId));
  await assertNoForeignIdCollision(trx, accountId, prepared.data);
  if (portableFingerprint(current, accountId) === fingerprint(prepared.data)) {
    return { imported: prepared.imported, changed: false, revision };
  }

  await trx.from('deleted_groups').where('account_id', accountId).delete();
  for (const key of [...INSERT_ORDER].reverse()) {
    await trx.from(TABLE_NAMES[key]).where('account_id', accountId).delete();
  }
  const account = prepared.data.accounts.at(0);
  if (!account) throw new Error('A prepared beta import always carries exactly one account.');
  await trx
    .from('accounts')
    .where('id', accountId)
    .update(encodeRow('accounts', account as unknown as Record<string, unknown>));
  for (const key of INSERT_ORDER) {
    const rows = prepared.data[key];
    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      await trx
        .table(TABLE_NAMES[key])
        .multiInsert(
          rows
            .slice(offset, offset + INSERT_CHUNK_SIZE)
            .map((row) => encodeRow(TABLE_NAMES[key], row as unknown as Record<string, unknown>))
        );
    }
  }
  await writeAudit(trx, {
    accountId,
    actorId,
    action: 'import',
    entity: 'account',
    entityId: accountId,
    fields: [],
  });
  const nextRevision = await advancePlanningRevision(trx, accountId);
  return { imported: prepared.imported, changed: true, revision: nextRevision };
}
