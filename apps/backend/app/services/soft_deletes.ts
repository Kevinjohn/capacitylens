import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { isAtLeast } from '@capacitylens/shared/domain/access';
import { activeCompanyRole } from '#services/auth/authorization';
import Activity from '#models/activity';
import Client from '#models/client';
import Project from '#models/project';
import Resource from '#models/resource';

export type LifecycleTable = 'clients' | 'projects' | 'resources' | 'activities';
type LifecycleModel =
  | InstanceType<typeof Client>
  | InstanceType<typeof Project>
  | InstanceType<typeof Resource>
  | InstanceType<typeof Activity>;

const models = {
  clients: Client,
  projects: Project,
  resources: Resource,
  activities: Activity,
} as const;

export class SoftDeletePolicyError extends Error {
  constructor(
    readonly code: 'forbidden' | 'not_found' | 'archive_required' | 'builtin_client',
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function assertLifecycleAuthority(
  trx: TransactionClientContract,
  actorId: string,
  accountId: string
) {
  const role = await activeCompanyRole(actorId, accountId, trx);
  if (!role || !isAtLeast(role, 'admin')) {
    throw new SoftDeletePolicyError('forbidden', 'Forbidden.', 403);
  }
}

async function findRow(
  trx: TransactionClientContract,
  accountId: string,
  table: LifecycleTable,
  id: string,
  mode: 'all' | 'deleted'
): Promise<LifecycleModel | undefined> {
  const query = models[table]
    .query({ client: trx })
    .withScopes((scopes) => scopes.forCompany(accountId));
  const selected = mode === 'deleted' ? query.onlyTrashed() : query.withTrashed();
  return (await selected.where('id', id).first()) as LifecycleModel | undefined;
}

/**
 * Soft-deletes an archived catalogue row within the caller's authorized company transaction.
 * The actor identifier must come from the caller's verified session; membership is re-read here.
 */
export async function softDeleteArchivedEntity(
  trx: TransactionClientContract,
  actorId: string,
  accountId: string,
  table: LifecycleTable,
  id: string
) {
  await assertLifecycleAuthority(trx, actorId, accountId);
  const row = await findRow(trx, accountId, table, id, 'all');
  if (!row) throw new SoftDeletePolicyError('not_found', 'The record was not found.', 404);
  if (table === 'clients' && (row as InstanceType<typeof Client>).builtin === true) {
    throw new SoftDeletePolicyError(
      'builtin_client',
      'The built-in Internal client cannot be deleted.',
      403
    );
  }
  if (!row.archivedAt) {
    throw new SoftDeletePolicyError(
      'archive_required',
      'Archive this record before deleting it.',
      409
    );
  }
  if (row.trashed) return row;
  await row.delete();
  return row;
}

/** Restores the delete marker while retaining the row's existing archived state. */
export async function restoreArchivedEntity(
  trx: TransactionClientContract,
  actorId: string,
  accountId: string,
  table: LifecycleTable,
  id: string
) {
  await assertLifecycleAuthority(trx, actorId, accountId);
  const row = await findRow(trx, accountId, table, id, 'deleted');
  if (!row) throw new SoftDeletePolicyError('not_found', 'The record was not found.', 404);
  if (table === 'clients' && (row as InstanceType<typeof Client>).builtin === true) {
    throw new SoftDeletePolicyError(
      'builtin_client',
      'The built-in Internal client cannot be restored.',
      403
    );
  }
  await row.restore();
  return row;
}
