import type {
  PlanningClientContext,
  PlanningSnapshot,
  PlanningTransport,
} from '@/data/planning/planningCacheController';
import type {
  PlanningExecution,
  PlanningIntent,
  PlanningMutationLookup,
  PlanningMutationSuccess,
} from '@/api/planningContracts';
import { APP_DATA_KEYS, emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';

type Row = { id: string; accountId?: string; [key: string]: unknown };
type Patch = Extract<PlanningMutationSuccess['projection'], { mode: 'patch' }>['changed'];
type Response =
  PlanningMutationSuccess | ((execution: PlanningExecution) => PlanningMutationSuccess);
type Queued =
  { kind: 'response'; response: Response; data?: AppData } | { kind: 'error'; error: unknown };

/** A controlled response source for frontend tests; scheduling and validation belong to the server. */
export class StubPlanningTransport implements PlanningTransport {
  readonly calls: PlanningIntent[] = [];
  private data = emptyAppData();
  private canWrite = true;
  private revisions = new Map<string, number>();
  private commitments = new Map<string, PlanningMutationLookup>();
  private queued: Queued[] = [];

  /** Replace the test's loaded rows and discard earlier calls, responses and commitments. */
  reset(companyId: string, data: AppData): void {
    this.data = structuredClone(data);
    this.canWrite = true;
    this.revisions.clear();
    this.revisions.set(companyId, 0);
    this.calls.length = 0;
    this.queued.length = 0;
    this.commitments.clear();
  }

  /** Replace canonical fixture rows without clearing revision or test response history. */
  updateSource(data: AppData): void {
    this.data = structuredClone(data);
  }

  /** Queue the exact server receipt, optionally with the canonical data returned by a later read. */
  respondNext(response: Response, data?: AppData): void {
    this.queued.push({ kind: 'response', response, ...(data ? { data } : {}) });
  }

  /** Queue a refusal or transport error without implementing the server's validation rule. */
  failNext(error: unknown): void {
    this.queued.push({ kind: 'error', error });
  }

  /** Set the canonical authority projection returned by subsequent reads. */
  setCanWrite(canWrite: boolean): void {
    this.canWrite = canWrite;
  }

  async read(context: PlanningClientContext, signal: AbortSignal): Promise<PlanningSnapshot> {
    signal.throwIfAborted();
    const data = emptyAppData();
    for (const entity of APP_DATA_KEYS) {
      const rows = this.rows(entity).filter((row) =>
        entity === 'accounts' ? row.id === context.companyId : row.accountId === context.companyId,
      );
      Object.assign(data, { [entity]: structuredClone(rows) });
    }
    return { revision: this.revisions.get(context.companyId) ?? 0, canWrite: this.canWrite, data };
  }

  async lookup(
    context: PlanningClientContext,
    mutationId: string,
    signal: AbortSignal,
  ): Promise<PlanningMutationLookup> {
    signal.throwIfAborted();
    return structuredClone(
      this.commitments.get(this.key(context.companyId, mutationId)) ?? {
        status: 'unknown',
        mutationId,
      },
    );
  }

  async execute(
    context: PlanningClientContext,
    execution: PlanningExecution,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess> {
    signal.throwIfAborted();
    this.calls.push(structuredClone(execution.intent));
    const queued = this.queued.shift();
    if (queued?.kind === 'error') throw queued.error;
    let receipt: PlanningMutationSuccess;
    if (queued) {
      receipt =
        typeof queued.response === 'function' ? queued.response(execution) : queued.response;
      if (queued.data) this.data = structuredClone(queued.data);
      else if (receipt.projection.mode === 'patch') this.applyPatch(receipt.projection.changed);
    } else {
      const changed: Patch = { upserts: [], removed: [] };
      const deletion = this.applySingleRow(context.companyId, execution.intent, changed);
      receipt = {
        status: 'committed',
        mutationId: execution.mutationId,
        revision: (this.revisions.get(context.companyId) ?? 0) + 1,
        restoration: {
          consumedGroupId: null,
          replacementGroupId: deletion ? crypto.randomUUID() : null,
        },
        projection: { mode: 'patch', history: 'retain', changed },
      };
    }
    this.revisions.set(context.companyId, receipt.revision);
    this.commitments.set(this.key(context.companyId, receipt.mutationId), {
      status: 'committed',
      mutationId: receipt.mutationId,
      revision: receipt.revision,
      ...(receipt.restoration.replacementGroupId
        ? { restorationGroupId: receipt.restoration.replacementGroupId }
        : {}),
    });
    return structuredClone(receipt);
  }

  private key(companyId: string, mutationId: string) {
    return `${companyId}\0${mutationId}`;
  }
  private rows(entity: AppDataKey): Row[] {
    return this.data[entity] as unknown as Row[];
  }
  private replaceRows(entity: AppDataKey, rows: Row[]) {
    Object.assign(this.data, { [entity]: rows });
  }

  private applyPatch(patch: Patch): void {
    for (const { entity, id } of patch.removed) {
      this.replaceRows(
        entity,
        this.rows(entity).filter((row) => row.id !== id),
      );
    }
    for (const { entity, row } of patch.upserts) {
      this.replaceRows(entity, [
        ...this.rows(entity).filter((current) => current.id !== row.id),
        structuredClone(row) as unknown as Row,
      ]);
    }
  }

  private applySingleRow(companyId: string, intent: PlanningIntent, changed: Patch): boolean {
    const create = (entity: AppDataKey, id: string, fields: object) => {
      const now = new Date().toISOString();
      const row = {
        ...NULLABLE_FIELDS[entity],
        createdAt: now,
        updatedAt: now,
        ...fields,
        id,
        ...(entity === 'accounts' ? {} : { accountId: companyId }),
      } as Row;
      this.replaceRows(entity, [...this.rows(entity).filter((current) => current.id !== id), row]);
      changed.upserts.push({ entity, row } as unknown as Patch['upserts'][number]);
    };
    const update = (entity: AppDataKey, id: string, changes: object) => {
      const previous = this.rows(entity).find((row) => row.id === id);
      if (!previous) throw new Error(`stub: load ${entity} row ${id} before updating it`);
      const row = { ...previous, ...changes, updatedAt: new Date().toISOString() };
      this.replaceRows(
        entity,
        this.rows(entity).map((current) => (current.id === id ? row : current)),
      );
      changed.upserts.push({ entity, row } as unknown as Patch['upserts'][number]);
    };
    const remove = (entity: AppDataKey, id: string) => {
      this.replaceRows(
        entity,
        this.rows(entity).filter((row) => row.id !== id),
      );
      changed.removed.push({ entity, id });
      return true;
    };
    switch (intent.operation) {
      case 'allocation.create':
        create('allocations', String(intent.allocation.id), intent.allocation);
        break;
      case 'allocation.update':
        update('allocations', intent.id, intent.changes);
        break;
      case 'allocation.delete':
        return remove('allocations', intent.id);
      case 'catalogue.create':
        create(intent.entity.entity, intent.entity.id, intent.entity.fields);
        break;
      case 'catalogue.update':
        update(intent.entity.entity, intent.entity.id, intent.entity.changes);
        break;
      case 'catalogue.delete':
        return remove(intent.entity.entity, intent.entity.id);
      case 'catalogue.archive':
        update(intent.entity.entity, intent.entity.id, { archivedAt: new Date().toISOString() });
        break;
      case 'catalogue.unarchive':
        update(intent.entity.entity, intent.entity.id, { archivedAt: null });
        break;
      case 'resource.create':
        create('resources', intent.id, intent.fields);
        break;
      case 'resource.update':
        update('resources', intent.id, intent.changes);
        break;
      case 'resource.archive':
        update('resources', intent.id, { archivedAt: new Date().toISOString() });
        break;
      case 'resource.unarchive':
        update('resources', intent.id, { archivedAt: null });
        break;
      case 'timeOff.create':
        create('timeOff', String(intent.timeOff.id), intent.timeOff);
        break;
      case 'timeOff.update':
        update('timeOff', intent.id, intent.changes);
        break;
      case 'timeOff.delete':
        return remove('timeOff', intent.id);
      case 'closure.create':
        create('closures', intent.id, intent.fields);
        break;
      case 'closure.update':
        update('closures', intent.id, intent.changes);
        break;
      case 'closure.delete':
        return remove('closures', intent.id);
      case 'settings.update':
        update('accounts', companyId, intent.changes);
        break;
      case 'allocation.createGroup':
      case 'allocation.deleteGroup':
      case 'allocation.duplicate':
      case 'allocation.repeat':
      case 'planning.restoreGroup':
      case 'timeOff.deleteGroup':
      case 'timeOff.repeat':
        throw new Error(`stub: queue a response for ${intent.operation}`);
    }
    return false;
  }
}
