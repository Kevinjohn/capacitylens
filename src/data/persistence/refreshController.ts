import type { RefreshOutcome } from "./facades";
import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { applyOps, diffOps } from "../syncOps";
import { incrementPersistenceDiagnostic } from "../persistenceDiagnostics";
import type { AttachmentState } from "./attachmentState";
import type { WriteQueue } from "./writeQueue";

interface BeginSuspensionInput {
  external: boolean;
}

interface CreateRefreshControllerInput {
  store: StoreApi<StoreState>;
  adapter: PersistenceAdapter;
  owner: AttachmentState;
  writes: WriteQueue;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
}

interface RefreshSequenceInput extends CreateRefreshControllerInput {
  dataAtSequenceStart: AppData;
  dataAtLoad: AppData;
  failedBeforeLoad: boolean;
  myToken: number;
  slice: AppData;
}

interface InstallLoadedSliceInput extends RefreshSequenceInput {
  currentData: AppData;
  editedMidLoad: boolean;
  lostFailedEdits: boolean;
}

interface RunRefreshOptions {
  abortIfSaveFailed: boolean;
  preserveParkedEdit: boolean;
  dataAtSequenceStart: AppData;
  publishFailure: () => void;
}

interface RefreshActiveOptions {
  abortIfSaveFailed?: boolean;
  markAccountLoadFailure?: boolean;
}

function buildRunOptions(
  input: Pick<CreateRefreshControllerInput, "store" | "owner">,
  id: string,
  options: RefreshActiveOptions,
): RunRefreshOptions {
  const { store, owner } = input;
  const markAccountLoadFailure = options.markAccountLoadFailure ?? false;
  if (markAccountLoadFailure && store.getState().activeAccountLoadFailed !== id) {
    owner.update({ failedAccountLoadRecovery: null });
  }
  const recovery = owner.current.failedAccountLoadRecovery;
  const dataAtSequenceStart = recovery?.accountId === id ? recovery.base : store.getState().data;
  return {
    abortIfSaveFailed: options.abortIfSaveFailed ?? false,
    preserveParkedEdit: store.getState().activeAccountLoadFailed === id,
    dataAtSequenceStart,
    publishFailure: () => {
      if (!markAccountLoadFailure) return;
      owner.update({ failedAccountLoadRecovery: recovery ?? { accountId: id, base: dataAtSequenceStart } });
      store.setState({ activeAccountLoadFailed: id });
    },
  };
}

async function awaitCurrentSave(owner: AttachmentState): Promise<void> {
  const currentSave = owner.current.inFlightSave;
  if (currentSave) await currentSave;
}

function isRefreshInactive(owner: AttachmentState, token: number): boolean {
  return owner.current.disposed || token !== owner.current.switchToken;
}

async function installSupersededSignedOutSlice({
  store,
  owner,
  writes,
  dataAtSequenceStart,
  dataAtLoad,
  slice,
}: RefreshSequenceInput): Promise<void> {
  // A newer refresh owns parked edits. A sign-out starts no replacement load, however, even
  // though this completed load has already re-seeded the adapter. Rebase only edits made during
  // this window and install the same hidden tree so signed-out store state and adapter seed remain
  // paired; activeAccountId is null, so no tenant data is exposed by this repair.
  if (store.getState().activeAccountId !== null) return;
  const currentData = store.getState().data;
  let installed = slice;
  if (currentData !== dataAtLoad || owner.current.pending !== null) {
    installed = applyOps(slice, diffOps(dataAtSequenceStart, currentData));
    incrementPersistenceDiagnostic("editsRebased");
    owner.update({ pending: null });
    owner.update({ unacknowledged: installed });
    writes.save(installed);
    await awaitCurrentSave(owner);
  }
  owner.installSlice(installed);
}

function resolveLoadedSlice({
  owner,
  dataAtSequenceStart,
  currentData,
  editedMidLoad,
  lostFailedEdits,
  slice,
}: InstallLoadedSliceInput): AppData {
  if (owner.current.externalSuspendDepth > 0) owner.update({ externalAuthoritativeData: slice });
  if (!editedMidLoad) {
    if (lostFailedEdits) {
      owner.update({ pending: null });
      owner.update({ unacknowledged: null });
    }
    return slice;
  }
  const editBase =
    owner.current.externalSuspendDepth > 0 && owner.current.externalBaseData
      ? owner.current.externalBaseData
      : dataAtSequenceStart;
  const installed = applyOps(slice, diffOps(editBase, currentData));
  incrementPersistenceDiagnostic("editsRebased");
  owner.update({ pending: installed });
  owner.update({ unacknowledged: installed });
  return installed;
}

function installLoadedSlice(input: RefreshSequenceInput): void {
  const { store, owner, onSuccess, failedBeforeLoad, dataAtLoad } = input;
  const currentData = store.getState().data;
  // These signals describe different outcomes. editedMidLoad is safely rebased onto the fresh
  // slice. lostFailedEdits describes an older failed write that replacement discards and must be
  // surfaced even when a newer mid-load edit was successfully preserved.
  const editedMidLoad = currentData !== dataAtLoad || owner.current.pending !== null;
  const lostFailedEdits = failedBeforeLoad && !owner.current.resolvingAuthoritativeReload;
  const installed = resolveLoadedSlice({ ...input, currentData, editedMidLoad, lostFailedEdits });
  if (lostFailedEdits) {
    owner.discardEdit(
      "capacitylens: an unsaved edit was discarded during an authoritative reload",
      "An edit could not be saved before this company’s data reloaded.",
    );
  }
  owner.installSlice(installed);
  store.setState({ activeAccountLoadFailed: null });
  owner.update({ failedAccountLoadRecovery: null });
  if (!editedMidLoad) owner.update({ unacknowledged: null });
  owner.update({ authoritativeReloadRequiredFor: null });
  owner.update({ failedSinceSuccess: false });
  owner.update({ retryAttempts: 0 });
  owner.cancelRetry();
  onSuccess?.();
}

async function flushBeforeLoad(
  input: CreateRefreshControllerInput,
  token: number,
  preserveParkedEdit: boolean,
): Promise<boolean> {
  const { owner, writes } = input;
  // First let the prior account's write settle. Then flush pending debounce data while store data
  // and adapter snapshot still describe the same account, before loadAll re-seeds the snapshot.
  await awaitCurrentSave(owner);
  if (owner.supersededBy(token)) return false;
  // A pending edit under an external suspension arrived during a server-side import. Flushing it
  // against the pre-import snapshot could recreate stale rows in the replacement, so it remains
  // parked for the operation-level rebase after loadAll.
  if (owner.current.pending && owner.current.externalSuspendDepth === 0 && !preserveParkedEdit) {
    writes.save(owner.current.pending);
    await awaitCurrentSave(owner);
    if (owner.supersededBy(token)) return false;
  }
  return true;
}

async function handleInactiveRefresh(input: RefreshSequenceInput): Promise<boolean> {
  const { owner, myToken } = input;
  if (!isRefreshInactive(owner, myToken)) return false;
  if (owner.current.disposed) return true;
  incrementPersistenceDiagnostic("reloadsSuperseded");
  await installSupersededSignedOutSlice(input);
  return true;
}

async function runRefresh(
  input: CreateRefreshControllerInput,
  id: string,
  options: RunRefreshOptions,
): Promise<Exclude<RefreshOutcome, { kind: "unattached" }>> {
  const { store, adapter, owner, writes, onError } = input;
  const { abortIfSaveFailed, preserveParkedEdit, dataAtSequenceStart, publishFailure } = options;
  // Guard a stale out-of-band account id before bumping the token. Bumping first could invalidate
  // the real account switch, then install the stale account under the new active id and enable
  // cross-tenant display or writes.
  if (owner.current.disposed || store.getState().activeAccountId !== id) return { kind: "skipped" };
  // Focus and post-lifecycle refreshes do not own account transitions. They must not supersede an
  // internal reload and then abort without a replacement load. External import suspension is the
  // exception because its owner deliberately invokes this refresh to re-seed after replacement.
  if (abortIfSaveFailed && owner.current.suspendDepth > owner.current.externalSuspendDepth) return { kind: "skipped" };
  const myToken = owner.nextSwitchToken();
  // Suspend writes across every await, not only loadAll. Edits arriving during the initial save,
  // flush, or load are parked until they can be included before re-seed or rebased afterward.
  const resume = owner.beginSuspension({ external: false, writes });
  try {
    if (!(await flushBeforeLoad(input, myToken, preserveParkedEdit))) return { kind: "skipped" };
    if (abortIfSaveFailed && owner.current.failedSinceSuccess) return { kind: "skipped" };
    // A pre-armed retry must not fire during load against the old snapshot and then have its
    // discarded save hidden by the successful reload bookkeeping.
    owner.cancelRetry();
    const dataAtLoad = store.getState().data;
    // Capture immediately before loadAll. A teardown write may fail during the load, but its edit
    // is part of this window and can be rebased; only an older failure risks replacement loss.
    const failedBeforeLoad = owner.current.failedSinceSuccess;
    const slice = await adapter.loadAll(id);
    const sequence = {
      ...input,
      dataAtSequenceStart,
      dataAtLoad,
      failedBeforeLoad,
      myToken,
      slice,
    };
    if (await handleInactiveRefresh(sequence)) return { kind: "skipped" };
    installLoadedSlice(sequence);
    return { kind: "reloaded" };
  } catch (error) {
    if (isRefreshInactive(owner, myToken)) return { kind: "skipped" };
    // Keep the prior store data and adapter snapshot paired when loadAll fails. A failed account
    // switch retains recovery ownership of any parked edit until an explicit retry rebases it or a
    // different selection deliberately discards it. The error remains visible through the callback.
    publishFailure();
    onError?.(error);
    return { kind: "failed" };
  } finally {
    resume();
  }
}

export function createRefreshController({
  store,
  adapter,
  owner,
  writes,
  onError,
  onSuccess,
}: CreateRefreshControllerInput) {
  const { save } = writes;
  const beginSuspension = ({ external }: BeginSuspensionInput) =>
    owner.beginSuspension({ external: external, writes: writes });
  // Re-hydrate ONE non-null account's slice and re-seed the adapter's diff snapshot to it,
  // ATOMICALLY — the shared body of both a tenant SWITCH (newId) and a refresh-on-focus
  // (activeId). Extracted (P1.16) precisely so refresh REUSES this exact sequence: the snapshot
  // (adapter.lastSynced) is private to the adapter and is re-seeded ONLY by loadAll, so a parallel
  // re-hydrate path (e.g. a React hook calling replaceAll) would leave `data` updated but the
  // snapshot stale → the next save would diff the fresh slice against the old snapshot and emit a
  // cross-account / garbage delta. The token discipline below also makes a late refresh that
  // resolves after a newer switch/refresh a no-op, so the two callers can't clobber each other.
  //
  // A per-switch token guards the whole sequence: each call bumps `switchToken`, and a SECOND
  // switch/refresh that supersedes a slow first one makes the first's late-resolving load a no-op
  // (it must not seed a stale account over the newer one).
  //
  // SEQUENCE (token-guarded throughout, see the inline (a)/(a′)/(b)/(c) markers):
  //   (a) await any in-flight save so a prior write can't land against the new snapshot;
  //  (a′) FLUSH (not drop) the current account's pending debounced edits while data AND the snapshot
  //       are BOTH still this account → the diff is self-vs-self (correct), landed BEFORE (b) reseeds;
  //   (b) adapter.loadAll(id) → returns the slice AND re-seeds lastSynced to it;
  //   (c) replaceAll(slice) under loadingSlice so the data subscription doesn't read it as an edit,
  //       then advance lastData.
  //
  // Mid-load edits are preserved as operations, not as a stale whole tree. At (c), diffOps derives
  // only the changes made during this sequence and applyOps rebases them onto the freshly loaded
  // server slice. This retains remote additions/lifecycle changes and avoids resurrecting rows,
  // while the rebased state is parked for an ordinary confirmed save after suspension lifts.
  //
  // abortIfSaveFailed (refresh-on-focus + the lifecycle hook's post-mutation reload — NOT tenant
  // switches): when the flush/await above still leaves a save FAILED, the refresh is ABANDONED.
  // Proceeding would loadAll+replaceAll the server's copy over the optimistic state AND re-seed the
  // diff snapshot to it, so the scheduled retry (which re-reads store state) would diff to ZERO ops,
  // "succeed", and clear the failure — permanently discarding the user's un-persisted edit. Aborting
  // keeps the edit in play: the retry/stranded-write machinery still holds it, and the persist banner
  // (raised via save's onError) already tells the user they're not synced. A tenant SWITCH deliberately
  // does NOT abort — refusing the load would leave account A's data rendered under account B's id (a
  // cross-tenant display, strictly worse); its flush failure is surfaced the same way and the loss is
  // bounded to the un-flushed edits.

  const refreshActive = (
    id: string,
    options: RefreshActiveOptions = {},
  ): Promise<Exclude<RefreshOutcome, { kind: "unattached" }>> =>
    runRefresh(
      {
        store,
        adapter,
        owner,
        writes,
        ...(onError ? { onError } : {}),
        ...(onSuccess ? { onSuccess } : {}),
      },
      id,
      buildRunOptions({ store, owner }, id, options),
    );

  // Resolve a stale/uncertain batch boundary exactly once at a time. A failed load deliberately
  // leaves authoritativeReloadRequiredFor set: subsequent online/focus activity retries the load,
  // while every write entry point remains closed. Only a successful reload permits the clean
  // acknowledgement/rebased follow-up write.
  function startAuthoritativeReload(activeId: string): void {
    if (owner.current.disposed || owner.current.resolvingAuthoritativeReload) return;
    owner.update({ resolvingAuthoritativeReload: true });
    void refreshActive(activeId)
      .then((outcome) => {
        if (owner.current.disposed || outcome.kind !== "reloaded") return;
        incrementPersistenceDiagnostic("reconciliationsResolved");
        // One follow-up save makes an empty diff acknowledge recovery, or lands only edits made
        // during the reload after refreshActive rebased them onto the authoritative slice.
        if (store.getState().activeAccountId !== activeId) return;
        if (owner.current.inFlightSave) return owner.current.inFlightSave;
        save(store.getState().data);
        return owner.current.inFlightSave;
      })
      .finally(() => {
        owner.update({ resolvingAuthoritativeReload: false });
      });
  }

  return { refreshActive, startAuthoritativeReload, beginSuspension };
}
export type RefreshController = ReturnType<typeof createRefreshController>;
