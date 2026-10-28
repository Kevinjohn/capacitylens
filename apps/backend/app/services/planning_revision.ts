import type { TransactionClientContract } from '@adonisjs/lucid/types/database';

const revisionsByTransaction = new WeakMap<
  TransactionClientContract,
  Map<string, Promise<number>>
>();

function revisionsFor(trx: TransactionClientContract) {
  let revisions = revisionsByTransaction.get(trx);
  if (!revisions) {
    revisions = new Map();
    revisionsByTransaction.set(trx, revisions);
  }
  return revisions;
}

/** Reads the current company planning revision, treating pre-migration rows as revision zero. */
export async function getPlanningRevision(
  trx: TransactionClientContract,
  accountId: string
): Promise<number> {
  const row = await trx
    .from('company_planning_revisions')
    .where('account_id', accountId)
    .select('revision')
    .first();
  const revision = row ? Number(row.revision) : 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid planning revision for company ${accountId}.`);
  }
  return revision;
}

/** Advances a company's planning revision once per supplied transaction. */
export function advancePlanningRevision(
  trx: TransactionClientContract,
  accountId: string
): Promise<number> {
  const revisions = revisionsFor(trx);
  const existing = revisions.get(accountId);
  if (existing) return existing;

  const pending = (async () => {
    const current = await trx
      .from('company_planning_revisions')
      .where('account_id', accountId)
      .select('revision')
      .first();
    if (current) {
      const revision = Number(current.revision);
      if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
        throw new Error(`Invalid planning revision for company ${accountId}.`);
      }
      await trx
        .from('company_planning_revisions')
        .where('account_id', accountId)
        .increment('revision', 1);
      return revision + 1;
    }
    await trx.table('company_planning_revisions').insert({ account_id: accountId, revision: 1 });
    return 1;
  })();
  revisions.set(accountId, pending);
  return pending;
}
