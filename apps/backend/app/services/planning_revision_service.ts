// Every typed planning mutation carries the `baseRevision` it was drafted against.
// `assertPlanningBaseRevision` refuses a mismatch with 409 `STALE_REVISION`.

import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import StalePlanningRevisionException from '#exceptions/stale_planning_revision_exception';

const revisionsByTransaction = new WeakMap<
  TransactionClientContract,
  Map<string, Promise<number>>
>();

/**
 * The company planning revision. The per-transaction advances stay module state, so every instance
 * advances a company once per transaction.
 */
export class PlanningRevisionService {
  #ensureTransactionRevisions(trx: TransactionClientContract) {
    let revisions = revisionsByTransaction.get(trx);
    if (!revisions) {
      revisions = new Map();
      revisionsByTransaction.set(trx, revisions);
    }
    return revisions;
  }

  /** Reads the current company planning revision; a company without a revision row reads as zero. */
  async getPlanningRevision(trx: TransactionClientContract, companyId: string): Promise<number> {
    const row = await trx
      .from('company_planning_revisions')
      .where('company_id', companyId)
      .select('revision')
      .first();
    const revision = row ? Number(row.revision) : 0;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error(`Invalid planning revision for company ${companyId}.`);
    }
    return revision;
  }

  /** Advances a company's planning revision once per supplied transaction. */
  advancePlanningRevision(trx: TransactionClientContract, companyId: string): Promise<number> {
    const revisions = this.#ensureTransactionRevisions(trx);
    const existing = revisions.get(companyId);
    if (existing) return existing;

    const pending = (async () => {
      const current = await trx
        .from('company_planning_revisions')
        .where('company_id', companyId)
        .select('revision')
        .first();
      if (current) {
        const revision = Number(current.revision);
        if (
          !Number.isSafeInteger(revision) ||
          revision < 0 ||
          revision === Number.MAX_SAFE_INTEGER
        ) {
          throw new Error(`Invalid planning revision for company ${companyId}.`);
        }
        await trx
          .from('company_planning_revisions')
          .where('company_id', companyId)
          .increment('revision', 1);
        return revision + 1;
      }
      await trx.table('company_planning_revisions').insert({ company_id: companyId, revision: 1 });
      return 1;
    })();
    revisions.set(companyId, pending);
    return pending;
  }

  /** Throw the conflict contract when the caller's captured revision is no longer current. */
  assertPlanningBaseRevision(
    baseRevision: number,
    currentRevision: number,
    mutationId: string
  ): void {
    if (baseRevision !== currentRevision) {
      throw new StalePlanningRevisionException(mutationId, baseRevision, currentRevision);
    }
  }
}
