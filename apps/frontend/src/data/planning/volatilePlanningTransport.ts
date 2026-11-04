import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { AppData } from '@capacitylens/shared/types/entities';
import { DomainError } from '@capacitylens/shared/domain/errors';
import { PlanningControllerError } from './planningCacheController';
import type { PlanningTransport } from './planningCacheController';
import { slice } from './volatileRows';
import type { Group } from './volatileRows';
import { apply, changed } from './volatileApply';

type Company = { data: AppData; revision: number; pendingRefetch: boolean };

/** Executes the same typed planning intents in page memory; reload resets the demo. */
export function createVolatilePlanningTransport(readData: () => AppData): PlanningTransport {
  const companies = new Map<string, Company>();
  const commitments = new Map<
    string,
    { companyId: string; revision: number; restorationGroupId?: string }
  >();
  const groups = new Map<string, Group>();
  const current = (companyId: string): Company => {
    let company = companies.get(companyId);
    if (!company) {
      company = { data: slice(readData(), companyId), revision: 0, pendingRefetch: false };
      companies.set(companyId, company);
    }
    return company;
  };
  return {
    resetAfterDemoImport(companyId, data) {
      const company = current(companyId);
      company.data = slice(data, companyId);
      company.revision += 1;
      company.pendingRefetch = false;
      for (const [id, group] of groups) if (group.companyId === companyId) groups.delete(id);
      for (const [id, commitment] of commitments) {
        if (commitment.companyId === companyId) commitments.delete(id);
      }
      return company.revision;
    },
    async read(context) {
      const company = current(context.companyId);
      const visible = slice(readData(), context.companyId);
      if (!company.pendingRefetch && JSON.stringify(visible) !== JSON.stringify(company.data)) {
        company.data = visible;
        company.revision += 1;
      }
      company.pendingRefetch = false;
      return { revision: company.revision, canWrite: true, data: company.data };
    },
    async execute(context, execution) {
      const company = current(context.companyId);
      // N9/N10 still mutate the demo store directly; include those page-memory edits in the
      // next typed command's validation even when no explicit planning read intervened.
      const visible = slice(readData(), context.companyId);
      if (!company.pendingRefetch && JSON.stringify(visible) !== JSON.stringify(company.data)) {
        company.data = visible;
        company.revision += 1;
      }
      if (commitments.has(execution.mutationId)) {
        throw new PlanningControllerError(
          'This planning change was already committed.',
          'MUTATION_ID_REUSED',
          409,
        );
      }
      if (execution.baseRevision !== company.revision) {
        throw new PlanningControllerError(
          'The schedule changed before this edit was saved.',
          'STALE_REVISION',
          409,
        );
      }
      const before = company.data;
      const after = { ...before };
      const draftGroups = new Map(groups);
      let result: ReturnType<typeof apply>;
      try {
        result = apply(after, context.companyId, execution.intent, draftGroups);
      } catch (error) {
        // Local domain assertions are definitive rejections, not uncertain network outcomes.
        if (error instanceof DomainError) {
          throw new PlanningControllerError(error.message, error.code.toUpperCase(), 400);
        }
        throw error;
      }
      if (result.clearsRestoration) {
        const count = [...groups.values()]
          .filter((group) => group.companyId === context.companyId)
          .reduce((sum, group) => sum + group.rows.length, 0);
        if (
          execution.confirmedRestorationCount !== undefined &&
          execution.confirmedRestorationCount !== count
        ) {
          throw new PlanningControllerError(
            'The restorable items changed. Review this change again.',
            'RESTORATION_CONFIRMATION_STALE',
            409,
            false,
            count,
          );
        }
        if (count > 0 && execution.confirmedRestorationCount === undefined) {
          throw new PlanningControllerError(
            `This change clears ${count} restorable items`,
            'RESTORATION_CONFIRMATION_REQUIRED',
            409,
            false,
            count,
          );
        }
      }
      if (result.clearsRestoration) {
        for (const [id, group] of draftGroups) {
          if (group.companyId === context.companyId) draftGroups.delete(id);
        }
      }
      company.data = after;
      company.revision += 1;
      company.pendingRefetch = result.refetch;
      groups.clear();
      for (const [id, group] of draftGroups) groups.set(id, group);
      if (result.consumedGroupId) groups.delete(result.consumedGroupId);
      const restorationGroupId = result.replacementGroupId ?? undefined;
      commitments.set(execution.mutationId, {
        companyId: context.companyId,
        revision: company.revision,
        ...(restorationGroupId ? { restorationGroupId } : {}),
      });
      return {
        status: 'committed',
        mutationId: execution.mutationId,
        revision: company.revision,
        restoration: {
          consumedGroupId: result.consumedGroupId,
          replacementGroupId: result.replacementGroupId,
        },
        projection: result.refetch
          ? { mode: 'refetch', history: 'clear' }
          : { mode: 'patch', history: 'retain', changed: changed(before, after) },
      } as PlanningMutationSuccess;
    },
    async lookup(_context, mutationId) {
      const commitment = commitments.get(mutationId);
      return commitment
        ? {
            status: 'committed',
            mutationId,
            revision: commitment.revision,
            ...(commitment.restorationGroupId && groups.has(commitment.restorationGroupId)
              ? { restorationGroupId: commitment.restorationGroupId }
              : {}),
          }
        : { status: 'unknown', mutationId };
    },
  };
}
