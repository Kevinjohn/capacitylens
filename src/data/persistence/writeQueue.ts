import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { BatchTooLargeError } from "../ServerSyncAdapter";
import { incrementPersistenceDiagnostic } from "../persistenceDiagnostics";
import type { AttachmentState } from "./attachmentState";

interface CreateWriteQueueInput {
  store: StoreApi<StoreState>;
  adapter: PersistenceAdapter;
  owner: AttachmentState;
  serverMode: boolean;
  startAuthoritativeReload: (id: string) => void;
  onError?: (error: unknown) => void;
}

const MAX_RETRY_ATTEMPTS = 5;

class WriteQueueOwner {
  private readonly input: CreateWriteQueueInput;

  constructor(input: CreateWriteQueueInput) {
    this.input = input;
  }

  save = (data: AppData): void => {
    const { owner, adapter } = this.input;
    if (owner.current.disposed || owner.isBlockedByFailedAccountLoad()) return;
    if (this.deferForAuthoritativeReload(data)) return;
    if (owner.current.pending === data) owner.update({ pending: null });
    const round = adapter.saveAll(data).then(
      () => {
        if (!owner.current.disposed) owner.acknowledge(data);
      },
      (error: unknown) => this.handleSaveFailure(data, error),
    );
    owner.update({ inFlightSave: round });
    void round.finally(() => {
      if (owner.current.inFlightSave === round) owner.update({ inFlightSave: null });
    });
  };

  private deferForAuthoritativeReload(data: AppData): boolean {
    const { owner, serverMode, store, startAuthoritativeReload } = this.input;
    if (!serverMode || owner.current.authoritativeReloadRequiredFor === null) return false;
    owner.update({ unacknowledged: data, pending: data });
    owner.cancelDebounce();
    owner.cancelRetry();
    const activeId = store.getState().activeAccountId;
    if (activeId === owner.current.authoritativeReloadRequiredFor) startAuthoritativeReload(activeId);
    return true;
  }

  private handleSaveFailure(data: AppData, error: unknown): void {
    const { owner, serverMode, onError } = this.input;
    if (owner.current.disposed) return;
    owner.update({ failedSinceSuccess: true, lastError: error });
    incrementPersistenceDiagnostic("savesFailed");
    onError?.(error);
    if (this.beginAuthoritativeReloadFor(error)) return;
    if (serverMode && error instanceof BatchTooLargeError) {
      owner.update({ terminalBatchSnapshot: data });
      owner.cancelRetry();
      return;
    }
    this.scheduleRetry();
  }

  private beginAuthoritativeReloadFor(error: unknown): boolean {
    const { owner, serverMode, startAuthoritativeReload } = this.input;
    return owner.beginAuthoritativeReloadFor({ error, serverMode, startAuthoritativeReload });
  }

  retryStrandedWrite = (): void => {
    const { owner, store } = this.input;
    if (owner.current.disposed || !owner.current.failedSinceSuccess || owner.current.suspendDepth > 0) return;
    const retryData = owner.current.unacknowledged ?? store.getState().data;
    if (owner.current.terminalBatchSnapshot === retryData) return;
    owner.cancelRetry();
    owner.update({ retryAttempts: 0 });
    this.save(retryData);
  };

  scheduleRetry = (): void => {
    const { owner } = this.input;
    if (
      owner.current.disposed ||
      owner.current.retryTimer ||
      owner.current.retryAttempts >= MAX_RETRY_ATTEMPTS ||
      owner.current.suspendDepth > 0 ||
      owner.isBlockedByFailedAccountLoad()
    )
      return;
    const delay = Math.min(1000 * 2 ** owner.current.retryAttempts, 30000);
    owner.update({ retryAttempts: owner.current.retryAttempts + 1 });
    incrementPersistenceDiagnostic("retriesArmed");
    owner.update({ retryTimer: setTimeout(() => this.runRetry(), delay) });
  };

  private runRetry(): void {
    const { owner, store } = this.input;
    owner.update({ retryTimer: null });
    if (owner.current.disposed || owner.current.suspendDepth > 0 || owner.isBlockedByFailedAccountLoad()) return;
    this.save(owner.current.unacknowledged ?? store.getState().data);
  }

  flushOnUnload = (): void => {
    const { owner, adapter } = this.input;
    if (owner.current.disposed || owner.isBlockedByFailedAccountLoad()) return;
    if (owner.current.externalSuspendDepth > 0) {
      this.reportParkedTeardownEdit();
      return;
    }
    if (owner.current.authoritativeReloadRequiredFor !== null) return;
    owner.cancelDebounce();
    const data = owner.current.unacknowledged;
    if (!data) return;
    void adapter.saveAll(data, { unload: true }).then(
      () => {
        if (!owner.current.disposed) owner.acknowledge(data);
      },
      (error: unknown) => this.handleUnloadFailure(error),
    );
  };

  private reportParkedTeardownEdit(): void {
    const { owner } = this.input;
    if (!owner.current.unacknowledged) return;
    owner.discardEdit(
      "capacitylens: a parked edit could not be sent during page teardown",
      "An edit was still parked while this company’s data was being replaced during page teardown.",
    );
  }

  private handleUnloadFailure(error: unknown): void {
    const { owner, onError } = this.input;
    if (owner.current.disposed) return;
    owner.update({ failedSinceSuccess: true });
    incrementPersistenceDiagnostic("savesFailed");
    onError?.(error);
    if (!this.beginAuthoritativeReloadFor(error)) this.scheduleRetry();
  }

  flushWhileAlive = (): void => {
    const { owner } = this.input;
    if (owner.current.disposed || owner.current.externalSuspendDepth > 0 || owner.isBlockedByFailedAccountLoad())
      return;
    owner.cancelDebounce();
    if (owner.current.unacknowledged) this.save(owner.current.unacknowledged);
  };
}

export function createWriteQueue(input: CreateWriteQueueInput) {
  const queue = new WriteQueueOwner(input);
  return {
    save: queue.save,
    scheduleRetry: queue.scheduleRetry,
    retryStrandedWrite: queue.retryStrandedWrite,
    flushOnUnload: queue.flushOnUnload,
    flushWhileAlive: queue.flushWhileAlive,
  };
}
export type WriteQueue = ReturnType<typeof createWriteQueue>;
