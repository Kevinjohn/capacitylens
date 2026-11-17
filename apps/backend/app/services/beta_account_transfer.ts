import { createHash } from 'node:crypto';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  BetaTransferError,
  buildBetaExport,
  parseBetaExport,
  prepareBetaImport,
  type BetaExportDocument,
} from '@capacitylens/shared/data/betaTransfer';
import {
  APP_DATA_KEYS,
  SCOPED_KEYS,
  SCOPED_WRITE_ORDER,
  type AppData,
} from '@capacitylens/shared/types/entities';
import { encodeRow, readStateWithClient } from '#services/state_repository';
import { tables } from '#services/product_tables';
import { EntityWriteError } from '#services/planning/errors';
import { getPlanningRevision, advancePlanningRevision } from '#services/planning_revision';
import { writeAudit } from '#services/audit';
import { discardRestorationGroups } from '#services/planning/restoration';

/**
 * Validates a document taken from a parsed request body, throwing a {@link BetaTransferError} that
 * names the reason when it is not a valid export. Nesting too deep to serialise is one such reason;
 * any other failure propagates.
 */
export function readRequestDocument(value: unknown): BetaExportDocument {
  try {
    return parseBetaExport(JSON.stringify(value));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BetaTransferError('document', 'is nested too deeply');
    }
    throw error;
  }
}

/** Like {@link readRequestDocument}, but returns null instead of naming why the document is invalid. */
export function parseRequestDocument(value: unknown): BetaExportDocument | null {
  try {
    return readRequestDocument(value);
  } catch (error) {
    if (error instanceof BetaTransferError) return null;
    throw error;
  }
}

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
  for (const key of SCOPED_WRITE_ORDER) {
    const ids = data[key].map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK_SIZE) {
      const foreign = await trx
        .from(tables[key])
        .whereIn('id', ids.slice(offset, offset + ID_LOOKUP_CHUNK_SIZE))
        .whereNot('account_id', accountId)
        .select('id')
        .first();
      if (foreign) {
        throw new EntityWriteError(
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

/**
 * Validates one full document against current company links and returns its visible impact: the
 * document's company name and its row count per scoped table.
 */
export async function previewBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument
) {
  const current = await readStateWithClient(trx, accountId, true);
  if (current.accounts.length !== 1) throw new EntityWriteError('Company not found.', 404);
  const prepared = prepareBetaImport(document, await context(trx, accountId));
  await assertNoForeignIdCollision(trx, accountId, prepared.data);
  const changed = portableFingerprint(current, accountId) !== fingerprint(prepared.data);
  const baseRevision = await getPlanningRevision(trx, accountId);
  const company = prepared.data.accounts.at(0);
  if (!company) throw new Error('A prepared beta import always carries exactly one account.');
  return {
    baseRevision,
    imported: prepared.imported,
    changed,
    companyName: company.name,
    counts: Object.fromEntries(SCOPED_KEYS.map((key) => [key, prepared.data[key].length])),
  };
}

/** Replaces the company slice with stable IDs; the caller owns authorization and password confirmation consumption. */
export async function applyBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument,
  baseRevision: number,
  actorId: string
) {
  const current = await readStateWithClient(trx, accountId, true);
  if (current.accounts.length !== 1) throw new EntityWriteError('Company not found.', 404);
  const revision = await getPlanningRevision(trx, accountId);
  if (revision !== baseRevision) {
    throw new EntityWriteError(
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

  await discardRestorationGroups(trx, accountId);
  for (const key of [...SCOPED_WRITE_ORDER].reverse()) {
    await trx.from(tables[key]).where('account_id', accountId).delete();
  }
  const account = prepared.data.accounts.at(0);
  if (!account) throw new Error('A prepared beta import always carries exactly one account.');
  await trx
    .from('accounts')
    .where('id', accountId)
    .update(encodeRow('accounts', account as unknown as Record<string, unknown>));
  for (const key of SCOPED_WRITE_ORDER) {
    const rows = prepared.data[key];
    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      await trx
        .table(tables[key])
        .multiInsert(
          rows
            .slice(offset, offset + INSERT_CHUNK_SIZE)
            .map((row) => encodeRow(tables[key], row as unknown as Record<string, unknown>))
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
