import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, ReloadDiscardedEditError, flushPendingWrites } from "./persist";
import {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchValidationError,
  BatchTooLargeError,
} from "./ServerSyncAdapter";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount } from "../test/fixtures";
import { readPersistenceDiagnosticsSnapshot } from "./persistenceDiagnostics";
import { requireCallback, recordingAdapter, a2Slice, attachActiveA2 } from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

async function attachHeldLossSwitch() {
  const bSlice: AppData = {
    ...emptyAppData(),
    accounts: [{ id: "b1", name: "Beta Two", color: "#1", createdAt: "t", updatedAt: "t" }],
  };
  let release: (() => void) | null = null;
  const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
    if (accountId !== "b1") return Promise.resolve(a2Slice());
    return new Promise<AppData>((resolve) => {
      release = () => resolve(bSlice);
    });
  });
  const saveAll = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries([
    { id: "a2", name: "Beta", role: "owner" },
    { id: "b1", name: "Beta Two", role: "owner" },
  ]);
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll, saveAll },
    debounceMs: 0,
    onError: onError,
    serverMode: true,
  });
  useStore.getState().setActiveAccount("a2");
  await vi.advanceTimersByTimeAsync(5);
  const readReleaseB = () => release;
  return { detach, onError, readReleaseB, saveAll };
}

async function attachRecoverableAccountSwitch() {
  const bSlice: AppData = {
    ...emptyAppData(),
    accounts: [{ id: "b1", name: "Beta Two", color: "#1", createdAt: "t", updatedAt: "t" }],
  };
  const loadAll = vi.fn(async (accountId?: string): Promise<AppData> => (accountId === "b1" ? bSlice : a2Slice()));
  const saveAll = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const onSuccess = vi.fn();
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries([
    { id: "a2", name: "Beta", role: "owner" },
    { id: "b1", name: "Beta Two", role: "owner" },
  ]);
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll, saveAll },
    debounceMs: 0,
    onError: onError,
    onSuccess: onSuccess,
    serverMode: true,
  });
  useStore.getState().setActiveAccount("a2");
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { detach, loadAll, onSuccess, saveAll };
}

describe("a successful reload clears the failure state (cross-tenant leak + stuck banner)", () => {
  it("a successful TENANT SWITCH clears the prior tenant's failed-write state — B's import/refresh are not blocked by A", async () => {
    const { detach, loadAll, onSuccess, saveAll } = await attachRecoverableAccountSwitch();

    // A's write fails → the failure state is up (import blocked, focus refresh suppressed).
    saveAll.mockRejectedValueOnce(new Error("server down"));
    useStore.getState().addClient({ name: "Doomed in A", color: "#222222" });
    await new Promise((r) => setTimeout(r, 5));
    expect(await flushPendingWrites()).toEqual({ kind: "blocked" });

    // Switching to B succeeds: B's writes are clean BY CONSTRUCTION (fresh authoritative slice,
    // snapshot re-seeded) — A's abandoned failure must not follow the user into B.
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    onSuccess.mockClear();
    useStore.getState().setActiveAccount("b1");
    await new Promise((r) => setTimeout(r, 5));
    expect(await flushPendingWrites()).toEqual({ kind: "clean" }); // an import in B is no longer falsely blocked
    expect(onSuccess).toHaveBeenCalled(); // and the "changes aren't saving" banner came down

    // The focus refresh in B is no longer suppressed by A's stale failedSinceSuccess.
    const loadsBefore = loadAll.mock.calls.length;
    now.mockReturnValue(131_000);
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 5));
    expect(loadAll.mock.calls.length).toBe(loadsBefore + 1);
    detach();
    now.mockRestore();
  });

  it("a switch past FAILED edits SURFACES the loss (typed sticky error) and cancels the stale backoff retry", async () => {
    // Two failure modes this pins: (1) the reset that makes B's writes clean must not SILENTLY
    // swallow the loss of A's un-persisted edits — the reload raises the typed sticky error for
    // them (the banner it clears was their only surface before); (2) the backoff retry armed by
    // A's failure must not survive into the reload and fire mid-/post-load with A's stale tree.
    vi.useFakeTimers();
    try {
      const { detach, onError, readReleaseB, saveAll } = await attachHeldLossSwitch();

      saveAll.mockRejectedValue(new Error("server down")); // every save now fails
      useStore.getState().addClient({ name: "Doomed in A", color: "#222222" });
      await vi.advanceTimersByTimeAsync(5); // save failed → failure state up, backoff retry armed
      const savesBeforeSwitch = saveAll.mock.calls.length;

      saveAll.mockResolvedValue(undefined); // the connection heals — but A's edit is already lost
      useStore.getState().setActiveAccount("b1");
      await vi.advanceTimersByTimeAsync(5);
      const releaseB = readReleaseB();
      expect(releaseB).not.toBeNull();
      const midSwitchEdit = useStore.getState().addClient({ name: "New in B", color: "#333333" });
      requireCallback(releaseB, "account B load release")();
      await vi.advanceTimersByTimeAsync(5);

      // The destination edit is rebased and saved, but that must not hide the older source loss.
      expect(useStore.getState().data.clients).toContainEqual(
        expect.objectContaining({
          id: midSwitchEdit.id,
          accountId: "b1",
        }),
      );
      expect(onError.mock.calls.some(([e]) => e instanceof ReloadDiscardedEditError)).toBe(true);
      // …and no retry ever replayed A's stale tree after the switch (35s covers every backoff).
      await vi.advanceTimersByTimeAsync(35_000);
      for (const [payload] of saveAll.mock.calls.slice(savesBeforeSwitch)) {
        expect((payload as AppData).clients.some((c) => c.name === "Doomed in A")).toBe(false);
      }
      expect(
        saveAll.mock.calls
          .slice(savesBeforeSwitch)
          .some(([payload]) => (payload as AppData).clients.some((c) => c.id === midSwitchEdit.id)),
      ).toBe(true);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("batch reconciliation (authoritative reload)", () => {
  // A 409 from /api/batch (optimistic concurrency) is NOT transient: retrying the same stale diff
  // 409s forever, and abortIfSaveFailed blocks the focus refresh that could break the loop — a
  // self-sustaining error wedge. The persist layer must instead resolve by RELOADING the active
  // slice (server wins, the local conflicting edit is deliberately discarded), surface the banner
  // via onError, and clear it via the follow-up clean save's onSuccess.
  it("a 409 conflict RELOADS the slice (no abort), does NOT arm the stale-diff retry, and the banner clears", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError, onSuccess: onSuccess });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      saveAll.mockRejectedValueOnce(new BatchConflictError("stale write"));

      useStore.getState().addClient({ name: "Conflicted", color: "#222222" }); // immediate save → 409
      await vi.advanceTimersByTimeAsync(5);

      expect(onError).toHaveBeenCalledTimes(1); // the banner surfaced "your edit did not save"
      // The resolution reload ran — deliberately WITHOUT abortIfSaveFailed (this reload IS the
      // resolution), unlike the focus refresh which must abort on a failed save.
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      // Server wins: the conflicting local edit was discarded for the server's slice.
      expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["c2", "internal:a2"]);
      // The follow-up clean save fired onSuccess so the banner comes back down.
      expect(onSuccess).toHaveBeenCalled();
      expect(readPersistenceDiagnosticsSnapshot()).toMatchObject({ savesFailed: 1, reconciliationsResolved: 1 });

      // The backoff retry was NOT armed with the stale diff: 35s covers every backoff step.
      const savesAfterResolution = saveAll.mock.calls.length; // the conflict save + the follow-up
      expect(savesAfterResolution).toBe(2);
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll.mock.calls.length).toBe(savesAfterResolution);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an uncertain 2xx receipt reloads before another write and never retries the prior diff", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      saveAll.mockRejectedValueOnce(new BatchCommitUncertainError("incomplete revisions"));

      useStore.getState().addClient({ name: "Uncertain", color: "#222222" });
      await vi.advanceTimersByTimeAsync(5);

      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BatchCommitUncertainError);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["c2", "internal:a2"]);
      const savesAfterResolution = saveAll.mock.calls.length;
      expect(savesAfterResolution).toBe(2); // uncertain attempt + clean post-reload acknowledgement
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll.mock.calls.length).toBe(savesAfterResolution);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 400 validation rejection reloads server truth and never retries the rejected diff", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError, onSuccess: onSuccess });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      onSuccess.mockClear();
      saveAll.mockRejectedValueOnce(
        new BatchValidationError("Allocation must reference an active resource in this company."),
      );

      useStore.getState().addClient({ name: "Rejected local edit", color: "#222222" });
      await vi.advanceTimersByTimeAsync(5);

      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BatchValidationError);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["c2", "internal:a2"]);
      expect(onSuccess).toHaveBeenCalled();

      const savesAfterResolution = saveAll.mock.calls.length;
      expect(savesAfterResolution).toBe(2); // rejected attempt + clean post-reload acknowledgement
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll.mock.calls.length).toBe(savesAfterResolution);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["conflict", () => new BatchConflictError("stale write")],
    ["uncertain receipt", () => new BatchCommitUncertainError("incomplete revisions")],
  ])("keeps a %s write-gated when its reload fails, then retries the reload on recovery", async (_label, error) => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      loadAll.mockRejectedValueOnce(new Error("reload unavailable"));
      const reconciliationError = error();
      saveAll.mockRejectedValueOnce(reconciliationError);

      useStore.getState().addClient({ name: "Uncertain", color: "#222222" });
      await vi.advanceTimersByTimeAsync(5);

      expect(saveAll).toHaveBeenCalledTimes(1); // the original, commit-uncertain attempt only
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1); // resolution was attempted
      expect(onError.mock.calls.some(([reported]) => reported === reconciliationError)).toBe(true);

      // Neither teardown keepalive nor the ordinary retry horizon may replay a batch that could
      // already have committed while the required authoritative load is unavailable.
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll).toHaveBeenCalledTimes(1);

      // Connectivity recovery retries loadAll first. Only after that succeeds may a clean/rebased
      // acknowledgement run; the original local edit remains discarded in favour of server truth.
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(5);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 2);
      expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["c2", "internal:a2"]);
      expect(saveAll).toHaveBeenCalledTimes(2);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a conflict DURING the resolution does not recurse — ONE reload, banner stays up", async () => {
    // The re-entry guard: the resolution's follow-up save can itself 409 (other pending edits also
    // stale). That must NOT trigger a second resolution reload (an unbounded reload↔save loop) —
    // it just surfaces the banner; a later focus/online re-attempt retriggers resolution.
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError, onSuccess: onSuccess });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      onSuccess.mockClear(); // a successful reload (incl. the pick) fires onSuccess by design now
      saveAll
        .mockRejectedValueOnce(new BatchConflictError("stale write")) // the edit's save
        .mockRejectedValueOnce(new BatchConflictError("still stale")); // the resolution's follow-up save

      useStore.getState().addClient({ name: "Conflicted", color: "#222222" });
      await vi.advanceTimersByTimeAsync(5);

      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1); // exactly ONE resolution reload
      expect(onError).toHaveBeenCalledTimes(2); // both conflicts surfaced
      // The resolution RELOAD fires onSuccess (an installed authoritative slice IS a healthy
      // sync), but the follow-up save's second 409 re-raises the banner AFTER it — the user's
      // final state is the banner up. Assert the ORDER, not "never called".
      const lastSuccess = Math.max(...onSuccess.mock.invocationCallOrder);
      const lastError = Math.max(...onError.mock.invocationCallOrder);
      expect(lastError).toBeGreaterThan(lastSuccess); // banner ends UP — the 409 outlives the reload's clear
      await vi.advanceTimersByTimeAsync(35_000); // and no retry/reload machinery re-fires
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      expect(saveAll.mock.calls.length).toBe(2);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an edit made during the conflict reload is rebased without restoring the original conflicted edit", async () => {
    // The reload window race: the 409 triggers refreshActive, and the user edits again while
    // loadAll is on the wire. The server slice is AUTHORITATIVE (server-wins): keeping the local
    // state and letting its save diff against the fresh snapshot would push the WHOLE pre-reload
    // tree — re-landing the exact edit the resolution just declared discarded and DELETE-ing rows
    // the other writer committed. Only the operation made during the reload may be rebased onto the
    // authoritative slice; the original conflicted edit must stay discarded.
    let hold = false;
    let release: (() => void) | null = null;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((resolve) => {
        release = () => resolve(slice);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError });

    saveAll.mockRejectedValueOnce(new BatchConflictError("stale write"));
    hold = true; // the resolution reload will now be held open

    useStore.getState().addClient({ name: "Conflicted", color: "#222222" }); // immediate save → 409
    await new Promise((r) => setTimeout(r, 5));
    expect(release).not.toBeNull(); // resolution reload in flight

    // A second edit lands while the reload is on the wire. (In this immediate-save configuration
    // its own save fires at edit time — pre-seed, so harmless; the danger is a save AFTER the
    // reload installed the slice re-pushing the pre-reload tree.)
    useStore.getState().addClient({ name: "During reload", color: "#333333" });
    await new Promise((r) => setTimeout(r, 5));
    const savesBeforeReloadSettled = saveAll.mock.calls.length;

    requireCallback(release, "conflict reload release")(); // the reload resolves LAST
    await new Promise((r) => setTimeout(r, 5));

    const names = useStore.getState().data.clients.map((c) => c.name);
    expect(names).toEqual(["Beta Client", "Internal", "During reload"]);
    expect(names).not.toContain("Conflicted");
    expect(onError.mock.calls.some(([e]) => e instanceof BatchConflictError)).toBe(true);
    const postReload = saveAll.mock.calls.slice(savesBeforeReloadSettled).map(([payload]) => payload as AppData);
    expect(postReload.some((payload) => payload.clients.some((c) => c.name === "During reload"))).toBe(true);
    expect(postReload.every((payload) => !payload.clients.some((c) => c.name === "Conflicted"))).toBe(true);
    detach();
  });

  it("a NON-conflict failure keeps the existing backoff retry (regression pin) — no conflict reload", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onSuccess = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onSuccess: onSuccess });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      onSuccess.mockClear(); // the pick's successful reload fires onSuccess by design now
      saveAll.mockRejectedValueOnce(new Error("temporarily unavailable"));

      useStore.getState().addClient({ name: "Transient", color: "#222222" });
      await vi.advanceTimersByTimeAsync(0); // first attempt fails, retry armed
      expect(onSuccess).not.toHaveBeenCalled();
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick); // a transient failure never reloads

      await vi.advanceTimersByTimeAsync(1000); // backoff #1 → succeeds
      expect(onSuccess).toHaveBeenCalled();
      // The optimistic edit survived (no server-wins reload for a transient failure).
      expect(useStore.getState().data.clients.some((c) => c.name === "Transient")).toBe(true);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an over-limit failure (BatchTooLargeError) is TERMINAL — no backoff retry, banner via onError", async () => {
    // Unlike a transient failure (the regression pin above), an over-limit diff would throw on EVERY
    // backoff attempt (the atomic batch refuses to split it), so persist.ts must STOP retrying — no
    // self-sustaining error wedge — while still surfacing the banner. It is NOT a conflict either, so
    // it must not trigger a server-wins reload. The current page's in-memory desired state remains
    // available for a later, smaller diff to clear the banner; closing/reloading discards it because
    // CapacityLens deliberately has no queued offline-write journal.
    vi.useFakeTimers();
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const detachP = attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError, onSuccess: onSuccess });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachP;
      const loadsAfterPick = loadAll.mock.calls.length;
      saveAll.mockClear();
      onSuccess.mockClear(); // the pick's successful reload fires onSuccess by design
      saveAll.mockRejectedValue(new BatchTooLargeError("Atomic sync exceeds the 5000-operation server limit."));

      useStore.getState().addClient({ name: "Too Big", color: "#222222" });
      await vi.advanceTimersByTimeAsync(0); // the save attempt → throws BatchTooLargeError
      expect(onError).toHaveBeenCalledTimes(1); // the banner surfaced "changes aren't saving"
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BatchTooLargeError);
      const savesAfterEdit = saveAll.mock.calls.length; // exactly the one over-limit attempt
      expect(savesAfterEdit).toBe(1);

      // 35s covers every backoff step: a TRANSIENT error re-attempts across it, a TERMINAL one does
      // not — and it never reloads (that is the conflict path, not this one).
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll.mock.calls.length).toBe(savesAfterEdit); // no background retry armed
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick); // terminal, not a server-wins reload
      expect(onError).toHaveBeenCalledTimes(1); // surfaced once, not looped

      window.dispatchEvent(new Event("online"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(saveAll).toHaveBeenCalledTimes(savesAfterEdit);
      expect(onError).toHaveBeenCalledTimes(1);

      saveAll.mockResolvedValue(undefined);
      useStore.getState().addClient({ name: "Smaller follow-up", color: "#333333" });
      await vi.advanceTimersByTimeAsync(0);
      expect(saveAll).toHaveBeenCalledTimes(savesAfterEdit + 1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });
});
