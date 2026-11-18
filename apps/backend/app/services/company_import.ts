import { createHash } from 'node:crypto';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  CompanyDocumentError,
  buildCompanyExport,
  parseCompanyExport,
  prepareCompanyImport,
  type CompanyExportDocument,
} from '@capacitylens/shared/data/companyDocument';
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
import { discardHistory } from '#services/planning/history';

/**
 * Validates a document taken from a parsed request body, throwing a {@link CompanyDocumentError} that
 * names the reason when it is not a valid export. Nesting too deep to serialise is one such reason;
 * any other failure propagates.
 */
export function readRequestDocument(value: unknown): CompanyExportDocument {
  try {
    return parseCompanyExport(JSON.stringify(value));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CompanyDocumentError('document', 'is nested too deeply');
    }
    throw error;
  }
}

/** Like {@link readRequestDocument}, but returns null instead of naming why the document is invalid. */
export function parseRequestDocument(value: unknown): CompanyExportDocument | null {
  try {
    return readRequestDocument(value);
  } catch (error) {
    if (error instanceof CompanyDocumentError) return null;
    throw error;
  }
}

const INSERT_CHUNK_SIZE = 32;
const ID_LOOKUP_CHUNK_SIZE = 200;

function buildFingerprint(data: AppData) {
  const rows = APP_DATA_KEYS.map((key) => [
    key,
    [...data[key]].sort((a, b) => a.id.localeCompare(b.id)),
  ]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function buildPortableFingerprint(data: AppData, companyId: string) {
  return buildFingerprint(buildCompanyExport(data, { companyId, completeness: 'full' }).data);
}

// Scheduling IDs are primary keys across every company, so a document exported from another
// company on this server cannot be inserted while that company still holds the same rows. Refusing
// here keeps preview and apply in agreement instead of surfacing a constraint failure after the
// Owner has confirmed with a password.
async function assertNoForeignIdCollision(
  trx: TransactionClientContract,
  companyId: string,
  data: AppData
) {
  for (const key of SCOPED_WRITE_ORDER) {
    const ids = data[key].map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK_SIZE) {
      const foreign = await trx
        .from(tables[key])
        .whereIn('id', ids.slice(offset, offset + ID_LOOKUP_CHUNK_SIZE))
        .whereNot('company_id', companyId)
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

async function readImportContext(trx: TransactionClientContract, companyId: string) {
  const links = await trx
    .from('account_member_resources')
    .where('company_id', companyId)
    .select('user_id', 'resource_id');
  return {
    companyId,
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
export async function previewCompanyImport(
  trx: TransactionClientContract,
  companyId: string,
  document: CompanyExportDocument
) {
  const current = await readStateWithClient(trx, companyId, true);
  if (current.accounts.length !== 1) throw new EntityWriteError('Company not found.', 404);
  const prepared = prepareCompanyImport(document, await readImportContext(trx, companyId));
  await assertNoForeignIdCollision(trx, companyId, prepared.data);
  const changed = buildPortableFingerprint(current, companyId) !== buildFingerprint(prepared.data);
  const baseRevision = await getPlanningRevision(trx, companyId);
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
export async function applyCompanyImport(
  trx: TransactionClientContract,
  companyId: string,
  document: CompanyExportDocument,
  baseRevision: number,
  actorId: string
) {
  const current = await readStateWithClient(trx, companyId, true);
  if (current.accounts.length !== 1) throw new EntityWriteError('Company not found.', 404);
  const revision = await getPlanningRevision(trx, companyId);
  if (revision !== baseRevision) {
    throw new EntityWriteError(
      'The company changed. Preview the current data again.',
      409,
      { revision },
      'IMPORT_SNAPSHOT_STALE'
    );
  }
  const prepared = prepareCompanyImport(document, await readImportContext(trx, companyId));
  await assertNoForeignIdCollision(trx, companyId, prepared.data);
  if (buildPortableFingerprint(current, companyId) === buildFingerprint(prepared.data)) {
    return { imported: prepared.imported, changed: false, revision };
  }

  await discardRestorationGroups(trx, companyId);
  await discardHistory(trx, companyId);
  for (const key of [...SCOPED_WRITE_ORDER].reverse()) {
    await trx.from(tables[key]).where('company_id', companyId).delete();
  }
  const account = prepared.data.accounts.at(0);
  if (!account) throw new Error('A prepared beta import always carries exactly one account.');
  await trx
    .from('accounts')
    .where('id', companyId)
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
    companyId,
    actorId,
    action: 'import',
    entity: 'account',
    entityId: companyId,
    fields: [],
  });
  const nextRevision = await advancePlanningRevision(trx, companyId);
  return { imported: prepared.imported, changed: true, revision: nextRevision };
}
