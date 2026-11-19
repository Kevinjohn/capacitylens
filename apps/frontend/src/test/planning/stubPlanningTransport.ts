import type {
  PlanningAuthority,
  PlanningClientContext,
  PlanningHistoryStep,
  PlanningReadRequest,
  PlanningSnapshot,
  PlanningTransport,
} from '@/data/planning/planningCacheTypes';
import { PlanningControllerError } from '@/data/planning/planningErrors';
import type {
  PlanningExecution,
  PlanningIntent,
  PlanningMutationSuccess,
} from '@/api/planningContracts';
import { resolveCalendarToday } from '@capacitylens/shared/lib/calendarToday';
import { APP_DATA_KEYS, emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData, AppDataKey, ISODate } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import type { CapacityRange, CapacitySection } from '@capacitylens/shared/lib/capacity';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAuthority } from './planningAuthorityFixtures';
import { makeReceipt } from './makeReceipt';
import { createServerHistoryModel } from './serverHistoryModel';

type Row = { id: string; companyId?: string; [key: string]: unknown };
/** Rows a queued write changes in the stub's canonical data, which the next read returns. */
export type PlanningPatch = {
  upserts: Array<
    { [Entity in AppDataKey]: { entity: Entity; row: AppData[Entity][number] } }[AppDataKey]
  >;
  removed: Array<{ entity: AppDataKey; id: string }>;
};
type Response =
  PlanningMutationSuccess | ((execution: PlanningExecution) => PlanningMutationSuccess);
type Queued =
  | {
      kind: 'response';
      response: Response;
      data?: AppData;
      changed?: (execution: PlanningExecution) => PlanningPatch;
    }
  | { kind: 'error'; error: unknown };

/** One recorded change: the company's rows before and after it, so undo and redo swap them back. */
type HistoryChange = { before: AppData; after: AppData };
/** One company's history: the shared model decides who holds it; the stacks hold the rows to swap. */
type CompanyHistory = {
  model: ReturnType<typeof createServerHistoryModel>;
  past: HistoryChange[];
  future: HistoryChange[];
};

/** The rows that differ between two reads of one company, in the receipt's shape. */
function diffRows(before: AppData, after: AppData): PlanningMutationSuccess['changes'] {
  const changes: PlanningPatch = { upserts: [], removed: [] };
  for (const entity of APP_DATA_KEYS) {
    const previous = new Map<string, unknown>(before[entity].map((row) => [row.id, row]));
    const current = new Set(after[entity].map((row) => row.id));
    for (const row of after[entity]) {
      if (JSON.stringify(previous.get(row.id)) !== JSON.stringify(row)) {
        changes.upserts.push({ entity, row } as PlanningPatch['upserts'][number]);
      }
    }
    for (const row of before[entity]) {
      if (!current.has(row.id)) changes.removed.push({ entity, id: row.id });
    }
  }
  return changes;
}

/** A controlled response source for frontend tests; scheduling and validation belong to the server. */
export class StubPlanningTransport implements PlanningTransport {
  readonly calls: PlanningIntent[] = [];
  /** Every undo and redo request, in order, including refused ones. */
  readonly historySteps: Array<'undo' | 'redo'> = [];
  private data = emptyAppData();
  private authority = makePlanningAuthority();
  private today: ISODate | null = null;
  private capacity: CapacitySection | null = null;
  /** The capacity window each read asked for; undefined for a read that asked for the default. */
  readonly readWindows: (CapacityRange | undefined)[] = [];
  private revisions = new Map<string, number>();
  private queued: Queued[] = [];
  private readGate: Promise<void> | null = null;
  private histories = new Map<string, CompanyHistory>();

  /** Replace the test's loaded rows and discard earlier calls and responses. */
  reset(companyId: string, data: AppData): void {
    this.data = structuredClone(data);
    this.authority = makePlanningAuthority();
    this.today = null;
    this.capacity = null;
    this.readWindows.length = 0;
    this.revisions.clear();
    this.revisions.set(companyId, 0);
    this.calls.length = 0;
    this.historySteps.length = 0;
    this.queued.length = 0;
    this.readGate = null;
    this.histories.clear();
  }

  /** Hold the next read, after it records its window, until the returned release is called. */
  holdNextRead(): () => void {
    let release = () => {};
    this.readGate = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** Replace canonical fixture rows without clearing test response history. The revision advances
   * only when the rows differ, as the server's does for a change a reader could see. */
  updateSource(data: AppData): void {
    if (JSON.stringify(data) !== JSON.stringify(this.data)) this.advanceRevisions();
    this.data = structuredClone(data);
  }

  /**
   * Queue the exact server receipt, optionally with the canonical data, or the rows it changes,
   * that a later read returns.
   */
  respondNext(
    response: Response,
    data?: AppData,
    changed?: (execution: PlanningExecution) => PlanningPatch,
  ): void {
    this.queued.push({
      kind: 'response',
      response,
      ...(data ? { data } : {}),
      ...(changed ? { changed } : {}),
    });
  }

  /** Queue a refusal or transport error without implementing the server's validation rule. */
  failNext(error: unknown): void {
    this.queued.push({ kind: 'error', error });
  }

  /** Set the canonical authority returned by subsequent reads: an Owner who can write, with these overrides. */
  setAuthority(overrides: Partial<PlanningAuthority>): void {
    this.authority = makePlanningAuthority(overrides);
  }

  /** Set the company date returned by subsequent reads, in place of the one read from the clock. */
  setToday(today: ISODate): void {
    this.today = today;
  }

  /** Set the capacity figures returned by subsequent reads, in place of a section with no resources. */
  setCapacity(capacity: CapacitySection): void {
    this.capacity = capacity;
  }

  /** The company date a read returns: the set value, or the clock's date in the company's zone. */
  todayFor(companyId: string): ISODate {
    if (this.today !== null) return this.today;
    const company = this.data.accounts.find((row) => row.id === companyId);
    return resolveCalendarToday(company?.timezone ?? 'Etc/GMT').date;
  }

  async read(
    context: PlanningClientContext,
    signal: AbortSignal,
    { window, historyId, ifRevision }: PlanningReadRequest = {},
  ): Promise<PlanningSnapshot> {
    signal.throwIfAborted();
    this.readWindows.push(window);
    const gate = this.readGate;
    this.readGate = null;
    if (gate) {
      await gate;
      signal.throwIfAborted();
    }
    const revision = this.revision(context.companyId);
    const history = this.history(context.companyId).model.report(historyId, revision);
    const base = {
      revision,
      authority: this.authority,
      today: this.todayFor(context.companyId),
      capacity: this.capacity ?? emptyCapacity(window),
      history: {
        canUndo: this.authority.canWrite && history.canUndo,
        canRedo: this.authority.canWrite && history.canRedo,
      },
    };
    return ifRevision === revision
      ? { ...base, slice: 'unchanged' }
      : { ...base, slice: 'full', data: this.companyRows(context.companyId) };
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
    const previousRevision = this.revision(context.companyId);
    const before = this.companyRows(context.companyId);
    let receipt: PlanningMutationSuccess;
    if (queued) {
      receipt =
        typeof queued.response === 'function' ? queued.response(execution) : queued.response;
      if (queued.data) this.data = structuredClone(queued.data);
      else if (queued.changed) this.applyPatch(queued.changed(execution));
    } else {
      const deletion = this.applySingleRow(context.companyId, execution.intent);
      receipt = makeReceipt(execution.mutationId, previousRevision + 1, {
        restoration: {
          consumedGroupId: null,
          replacementGroupId: deletion ? crypto.randomUUID() : null,
        },
      });
    }
    // Like the server, the receipt carries the rows the write changed.
    receipt = { ...receipt, changes: diffRows(before, this.companyRows(context.companyId)) };
    this.revisions.set(context.companyId, receipt.revision);
    this.record(
      context.companyId,
      execution.historyId ?? undefined,
      previousRevision,
      receipt.revision,
      {
        before,
        after: this.companyRows(context.companyId),
      },
    );
    return structuredClone(receipt);
  }

  undo(
    context: PlanningClientContext,
    step: PlanningHistoryStep,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess> {
    return this.step('undo', context, step, signal);
  }

  redo(
    context: PlanningClientContext,
    step: PlanningHistoryStep,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess> {
    return this.step('redo', context, step, signal);
  }

  /**
   * Swaps the company's rows back to the recorded before or after state.
   * A stale basis is refused with STALE_REVISION, an empty
   * direction with a bare 409, and a queued refusal ends the history.
   */
  private async step(
    kind: 'undo' | 'redo',
    context: PlanningClientContext,
    step: PlanningHistoryStep,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess> {
    signal.throwIfAborted();
    this.historySteps.push(kind);
    const { companyId } = context;
    if (this.queued[0]?.kind === 'error') {
      const queued = this.queued.shift() as Extract<Queued, { kind: 'error' }>;
      this.histories.delete(companyId);
      throw queued.error;
    }
    const revision = this.revision(companyId);
    if (step.baseRevision !== revision) {
      throw new PlanningControllerError('The planning data changed.', 'STALE_REVISION', 409);
    }
    const history = this.history(companyId);
    const available = history.model.report(step.historyId, revision);
    if (!(kind === 'undo' ? available.canUndo : available.canRedo)) {
      throw new PlanningControllerError(`There is nothing to ${kind}.`, undefined, 409);
    }
    history.model.step(kind, step.historyId, revision, revision + 1);
    const [from, to] =
      kind === 'undo' ? [history.past, history.future] : [history.future, history.past];
    const change = from.pop();
    if (!change) throw new Error(`stub: the ${kind} stack is out of step with the history model`);
    const before = this.companyRows(companyId);
    this.replaceCompanyRows(companyId, kind === 'undo' ? change.before : change.after, kind);
    to.push(change);
    this.revisions.set(companyId, revision + 1);
    return makeReceipt(step.mutationId, revision + 1, {
      changes: diffRows(before, this.companyRows(companyId)),
    });
  }

  private advanceRevisions(): void {
    for (const [companyId, revision] of this.revisions) this.revisions.set(companyId, revision + 1);
  }

  private revision(companyId: string): number {
    return this.revisions.get(companyId) ?? 0;
  }

  /** The company's history, created empty on first use. */
  private history(companyId: string): CompanyHistory {
    let history = this.histories.get(companyId);
    if (!history) {
      history = { model: createServerHistoryModel(), past: [], future: [] };
      this.histories.set(companyId, history);
    }
    return history;
  }

  /** Records a committed change: it extends the writer's live history or starts a new one. */
  private record(
    companyId: string,
    historyId: string | undefined,
    previousRevision: number,
    revision: number,
    change: HistoryChange,
  ): void {
    const history = this.history(companyId);
    const continues = history.model.isLive(historyId, previousRevision);
    history.model.committed(historyId, previousRevision, revision);
    history.past = historyId === undefined ? [] : [...(continues ? history.past : []), change];
    history.future = [];
  }

  private companyRows(companyId: string): AppData {
    const data = emptyAppData();
    for (const entity of APP_DATA_KEYS) {
      const rows = this.rows(entity).filter((row) =>
        entity === 'accounts' ? row.id === companyId : row.companyId === companyId,
      );
      Object.assign(data, { [entity]: structuredClone(rows) });
    }
    return data;
  }

  private replaceCompanyRows(companyId: string, rows: AppData, kind: 'undo' | 'redo'): void {
    for (const entity of APP_DATA_KEYS) {
      const inCompany = (row: Row) =>
        entity === 'accounts' ? row.id === companyId : row.companyId === companyId;
      const others = this.rows(entity).filter((row) => !inCompany(row));
      const restored = structuredClone(rows[entity]) as unknown as Row[];
      const restoredIds = new Set(restored.map((row) => row.id));
      const archived =
        kind === 'undo'
          ? this.rows(entity)
              .filter((row) => inCompany(row) && !restoredIds.has(row.id) && 'archivedAt' in row)
              .map((row) => ({ ...row, archivedAt: row.archivedAt ?? '2026-01-01T00:00:00.000Z' }))
          : [];
      this.replaceRows(entity, [...others, ...restored, ...archived]);
    }
  }

  private rows(entity: AppDataKey): Row[] {
    return this.data[entity] as unknown as Row[];
  }
  private replaceRows(entity: AppDataKey, rows: Row[]) {
    Object.assign(this.data, { [entity]: rows });
  }

  private applyPatch(patch: PlanningPatch): void {
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

  private applySingleRow(companyId: string, intent: PlanningIntent): boolean {
    const nextDisciplineSortOrder = () =>
      this.rows('disciplines')
        .filter((row) => row.companyId === companyId)
        .reduce((next, row) => Math.max(next, Number(row.sortOrder) + 1), 0);
    const create = (entity: AppDataKey, id: string, fields: object) => {
      const now = new Date().toISOString();
      const row = {
        ...NULLABLE_FIELDS[entity],
        createdAt: now,
        updatedAt: now,
        ...fields,
        id,
        ...(entity === 'accounts' ? {} : { companyId }),
      } as Row;
      this.replaceRows(entity, [...this.rows(entity).filter((current) => current.id !== id), row]);
    };
    const update = (entity: AppDataKey, id: string, changes: object) => {
      const previous = this.rows(entity).find((row) => row.id === id);
      if (!previous) throw new Error(`stub: load ${entity} row ${id} before updating it`);
      const row = { ...previous, ...changes };
      this.replaceRows(
        entity,
        this.rows(entity).map((current) => (current.id === id ? row : current)),
      );
    };
    const remove = (entity: AppDataKey, id: string) => {
      this.replaceRows(
        entity,
        this.rows(entity).filter((row) => row.id !== id),
      );
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
        create(
          intent.entity.entity,
          intent.entity.id,
          // Like the server, append a new discipline after the company's highest sort order.
          intent.entity.entity === 'disciplines'
            ? { ...intent.entity.fields, sortOrder: nextDisciplineSortOrder() }
            : intent.entity.fields,
        );
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
      case 'timeOff.deleteGroup':
      case 'timeOff.repeat':
        throw new Error(`stub: queue a response for ${intent.operation}`);
    }
    return false;
  }
}
