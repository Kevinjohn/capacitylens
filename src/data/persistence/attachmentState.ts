import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import { incrementPersistenceDiagnostic, setPersistenceSuspended } from "../persistenceDiagnostics";
import { BatchReconciliationError } from "../ServerSyncAdapter";
import { ReloadDiscardedEditError, type RefreshOutcome } from "./facades";

interface OwnerBeginSuspensionInput {
  external: boolean;
  writes: { save: (data: AppData) => void; scheduleRetry: () => void };
}

interface BeginAuthoritativeReloadForInput {
  error: unknown;
  serverMode: boolean;
  startAuthoritativeReload: (id: string) => void;
}

interface AttachmentValues {
  disposed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastData: AppData;
  pending: AppData | null;
  unacknowledged: AppData | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempts: number;
  failedSinceSuccess: boolean;
  lastError: unknown | null;
  terminalBatchSnapshot: AppData | null;
  resolvingAuthoritativeReload: boolean;
  authoritativeReloadRequiredFor: string | null;
  failedAccountLoadRecovery: { accountId: string; base: AppData } | null;
  inFlightSave: Promise<void> | null;
  suspendDepth: number;
  externalSuspendDepth: number;
  externalBaseData: AppData | null;
  externalAuthoritativeData: AppData | null;
  loadingSlice: boolean;
  switchToken: number;
  lastActiveAccountId: string | null;
  lastRefreshAt: number;
  focusRefreshInFlight: boolean;
  switchWaiters: Array<{ id: string | null; resolve: (outcome: RefreshOutcome) => void }>;
}

function createAttachmentValues(store: StoreApi<StoreState>): AttachmentValues {
  return {
    disposed: false,
    timer: null,
    lastData: store.getState().data,
    pending: null,
    unacknowledged: null,
    retryTimer: null,
    retryAttempts: 0,
    failedSinceSuccess: false,
    lastError: null,
    terminalBatchSnapshot: null,
    resolvingAuthoritativeReload: false,
    authoritativeReloadRequiredFor: null,
    failedAccountLoadRecovery: null,
    inFlightSave: null,
    suspendDepth: 0,
    externalSuspendDepth: 0,
    externalBaseData: null,
    externalAuthoritativeData: null,
    loadingSlice: false,
    switchToken: 0,
    lastActiveAccountId: store.getState().activeAccountId,
    lastRefreshAt: 0,
    focusRefreshInFlight: false,
    switchWaiters: [],
  };
}

class AttachmentOwner {
  private readonly values: AttachmentValues;
  private readonly store: StoreApi<StoreState>;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onSuccess: (() => void) | undefined;

  constructor(store: StoreApi<StoreState>, onError?: (error: unknown) => void, onSuccess?: () => void) {
    this.store = store;
    this.onError = onError;
    this.onSuccess = onSuccess;
    this.values = createAttachmentValues(store);
  }

  get current(): Readonly<AttachmentValues> {
    return this.values;
  }
  update(patch: Partial<AttachmentValues>): void {
    Object.assign(this.values, patch);
  }
  nextSwitchToken(): number {
    return ++this.values.switchToken;
  }
  dispose(): void {
    if (this.values.disposed) return;
    this.values.disposed = true;
    for (const waiter of this.values.switchWaiters.splice(0)) waiter.resolve({ kind: "unattached" });
    setPersistenceSuspended(false);
  }
  cancelDebounce(): void {
    if (!this.values.timer) return;
    clearTimeout(this.values.timer);
    this.values.timer = null;
  }
  cancelRetry(): void {
    if (!this.values.retryTimer) return;
    clearTimeout(this.values.retryTimer);
    this.values.retryTimer = null;
  }
  discardEdit(warning: string, message: string): void {
    incrementPersistenceDiagnostic("editsDiscarded");
    console.warn(warning);
    this.onError?.(new ReloadDiscardedEditError(message));
  }
  supersededBy(token: number): boolean {
    if (!this.values.disposed && token === this.values.switchToken) return false;
    if (!this.values.disposed) incrementPersistenceDiagnostic("reloadsSuperseded");
    return true;
  }
  beginAuthoritativeReloadFor(input: BeginAuthoritativeReloadForInput): boolean {
    if (!input.serverMode || !(input.error instanceof BatchReconciliationError)) return false;
    this.cancelRetry();
    const activeId = this.store.getState().activeAccountId;
    if (activeId !== null) {
      this.values.authoritativeReloadRequiredFor = activeId;
      input.startAuthoritativeReload(activeId);
    }
    return true;
  }
  acknowledge(data: AppData): void {
    if (this.values.disposed) return;
    const acknowledgesLatest = this.values.unacknowledged === data || this.values.unacknowledged === null;
    if (this.values.unacknowledged === data) this.values.unacknowledged = null;
    if (this.values.pending === data) this.values.pending = null;
    if (!acknowledgesLatest) return;
    this.update({ retryAttempts: 0, failedSinceSuccess: false, terminalBatchSnapshot: null, lastError: null });
    this.cancelRetry();
    this.onSuccess?.();
  }
  installSlice(data: AppData): void {
    this.values.loadingSlice = true;
    this.store.getState().replaceAll(data);
    this.values.lastData = this.store.getState().data;
    this.values.loadingSlice = false;
  }
  beginSuspension({ external, writes }: OwnerBeginSuspensionInput): (options?: { dropParkedEdits?: boolean }) => void {
    if (this.values.disposed) return () => {};
    this.values.suspendDepth += 1;
    setPersistenceSuspended(true);
    if (external) this.beginExternalSuspension();
    this.cancelDebounce();
    this.cancelRetry();
    let resumed = false;
    return (options = {}) => {
      if (this.values.disposed || resumed) return;
      resumed = true;
      this.resumeSuspension(external, writes, options.dropParkedEdits === true);
    };
  }
  private beginExternalSuspension(): void {
    if (this.values.externalSuspendDepth === 0) {
      this.values.externalBaseData = this.store.getState().data;
      this.values.externalAuthoritativeData = null;
    }
    this.values.externalSuspendDepth += 1;
  }
  private resumeSuspension(
    external: boolean,
    writes: OwnerBeginSuspensionInput["writes"],
    dropParkedEdits: boolean,
  ): void {
    this.values.suspendDepth -= 1;
    if (external) this.values.externalSuspendDepth -= 1;
    if (this.values.suspendDepth > 0) return;
    setPersistenceSuspended(false);
    if (this.values.failedAccountLoadRecovery !== null) return;
    if (!this.values.pending) {
      this.clearExternalState();
      if (this.values.failedSinceSuccess && this.values.authoritativeReloadRequiredFor === null) writes.scheduleRetry();
      return;
    }
    if (!dropParkedEdits) {
      const parked = this.values.pending;
      this.clearExternalState();
      writes.save(parked);
      return;
    }
    this.values.pending = null;
    this.values.unacknowledged = null;
    this.values.externalBaseData = null;
    if (this.values.externalAuthoritativeData) this.installSlice(this.values.externalAuthoritativeData);
    this.values.externalAuthoritativeData = null;
    this.discardEdit(
      "capacitylens: an edit made during a company-data replacement was discarded",
      "An edit arrived while this company’s data was being replaced and could not be saved.",
    );
  }
  private clearExternalState(): void {
    this.values.externalBaseData = null;
    this.values.externalAuthoritativeData = null;
  }
}

/** One live owner per attachment. Consumers read current after every async boundary. */
export function createAttachmentState(
  store: StoreApi<StoreState>,
  onError?: (error: unknown) => void,
  onSuccess?: () => void,
) {
  const owner = new AttachmentOwner(store, onError, onSuccess);
  return {
    get current() {
      return owner.current;
    },
    update: owner.update.bind(owner),
    nextSwitchToken: owner.nextSwitchToken.bind(owner),
    dispose: owner.dispose.bind(owner),
    cancelDebounce: owner.cancelDebounce.bind(owner),
    cancelRetry: owner.cancelRetry.bind(owner),
    discardEdit: owner.discardEdit.bind(owner),
    supersededBy: owner.supersededBy.bind(owner),
    beginAuthoritativeReloadFor: owner.beginAuthoritativeReloadFor.bind(owner),
    acknowledge: owner.acknowledge.bind(owner),
    installSlice: owner.installSlice.bind(owner),
    beginSuspension: owner.beginSuspension.bind(owner),
  };
}
export type AttachmentState = ReturnType<typeof createAttachmentState>;
