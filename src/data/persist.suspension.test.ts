import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  attachPersistence,
  flushPendingWrites,
  refreshActiveAccountSlice,
  ReloadDiscardedEditError,
  suspendServerWrites,
} from "./persist";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount, requireValue } from "../test/fixtures";
import { readPersistenceDiagnosticsSnapshot } from "./persistenceDiagnostics";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { requireCallback, recordingAdapter, a2Slice, attachActiveA2 } from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

function heldFirstSaveAdapter() {
  let release: (() => void) | null = null;
  let firstHeld = true;
  const saveAll = vi.fn<(data: AppData) => Promise<void>>(() => {
    if (!firstHeld) return Promise.resolve();
    firstHeld = false;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const loadAll = vi.fn(async () => a2Slice());
  const releaseFirst = () => requireCallback(release, "first flush release")();
  return { adapter: { loadAll, saveAll }, releaseFirst, saveAll };
}

describe("flushPendingWrites (the import seam)", () => {
  it("lands a pending debounced edit and reports clean; reports NOT clean while a write is failed", async () => {
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300 }); // genuinely debounced
    saveAll.mockClear();

    useStore.getState().addClient({ name: "Pending", color: "#222222" }); // parked in the debounce
    expect(saveAll).not.toHaveBeenCalled();
    expect(await flushPendingWrites()).toEqual({ kind: "clean" }); // flushed + landed
    expect(saveAll).toHaveBeenCalledTimes(1);

    // A failing write makes the seam report dirty — the import path must refuse to proceed.
    saveAll.mockRejectedValueOnce(new Error("server down"));
    useStore.getState().addClient({ name: "Doomed", color: "#333333" });
    await expect(flushPendingWrites()).resolves.toMatchObject({ kind: "failed", error: new Error("server down") });
    detach();
  });

  it("returns clean when no orchestrator is attached and there is nothing to flush", async () => {
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
  });

  it('loops until QUIESCENT — an edit landing mid-flush is also flushed before "clean" is reported', async () => {
    // Writes are unsuspended during the flush's await, so an edit can arm a fresh debounce whose
    // save outlives a single round. A one-shot flush returned "clean" while that save was still
    // on the wire — the import POST then raced it against the pre-import snapshot.
    const { adapter, releaseFirst, saveAll } = heldFirstSaveAdapter();
    const detach = await attachActiveA2({ adapter, debounceMs: 300 });

    useStore.getState().addClient({ name: "First", color: "#222222" }); // parked in the debounce
    const flush = flushPendingWrites(); // consumes it → round-trip A, held open
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);

    useStore.getState().addClient({ name: "Mid-flush", color: "#333333" }); // lands during A's await
    releaseFirst();
    expect(await flush).toEqual({ kind: "clean" });
    // The flush swept the mid-flush edit too before reporting clean — nothing left on the wire.
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect((saveAll.mock.calls[1]?.[0] as AppData).clients.some((c) => c.name === "Mid-flush")).toBe(true);
    detach();
  });

  it("reports not clean when a slice refresh starts while the flush awaits a write", async () => {
    let releaseSave!: () => void;
    const saveAll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    const loadAll = vi.fn(async () => a2Slice());
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 300 });
    loadAll.mockClear();

    useStore.getState().addClient({ name: "Pending", color: "#222222" });
    const flush = flushPendingWrites();
    await vi.waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
    const refresh = refreshActiveAccountSlice("a2");
    releaseSave();

    await expect(flush).resolves.toEqual({ kind: "blocked" });
    await expect(refresh).resolves.toEqual({ kind: "reloaded" });
    detach();
  });
});

describe("suspendServerWrites (the import write-suspension seam)", () => {
  // The server-mode import suspends writes across its POST + re-hydrate: flushPendingWrites only
  // proves cleanliness at one INSTANT, so an edit made while the POST is pending must be PARKED —
  // sending it would either land just before the import (silently wiped) or be flushed by the
  // post-import reload against the pre-import snapshot (stale rows upserted into the imported
  // slice — remapped ids insert cleanly, no 409 stops them).
  it("parks an already armed retry until the suspension resumes", async () => {
    vi.useFakeTimers();
    try {
      const saveAll = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll: async () => emptyAppData(), saveAll },
        debounceMs: 0,
        onError: vi.fn(),
        serverMode: true,
      });

      useStore.getState().addClient({ name: "Retry me", color: "#222222" });
      await vi.advanceTimersByTimeAsync(0);
      expect(saveAll).toHaveBeenCalledOnce();

      const resume = suspendServerWrites();
      expect(readPersistenceDiagnosticsSnapshot().suspended).toBe(true);
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll).toHaveBeenCalledOnce();

      resume();
      expect(readPersistenceDiagnosticsSnapshot().suspended).toBe(false);
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll).toHaveBeenCalledTimes(2);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a hidden-tab visibility flush parked until an external suspension resumes", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const saveAll = vi.fn().mockResolvedValue(undefined);
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll: async () => emptyAppData(), saveAll },
        debounceMs: 300,
        serverMode: true,
      });
      const resume = suspendServerWrites();
      useStore.getState().addClient({ name: "Parked while hidden", color: "#222222" });

      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll).not.toHaveBeenCalled();

      resume();
      await vi.advanceTimersByTimeAsync(300);
      expect(saveAll).toHaveBeenCalledOnce();
      detach();
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("surfaces a parked external-suspension edit when page teardown cannot flush it safely", async () => {
    const onError = vi.fn();
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300, onError: onError });
    saveAll.mockClear();
    const resume = suspendServerWrites();
    useStore.getState().addClient({ name: "Parked at teardown", color: "#222222" });

    window.dispatchEvent(new Event("pagehide"));

    expect(saveAll).not.toHaveBeenCalled();
    expect(onError.mock.calls.some(([error]) => error instanceof ReloadDiscardedEditError)).toBe(true);
    resume();
    detach();
  });

  it("parks an edit made while suspended (nothing sent) and re-schedules it on resume when no reload ran", async () => {
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter }); // immediate saves
    saveAll.mockClear();

    const resume = suspendServerWrites();
    useStore.getState().addClient({ name: "Mid-import", color: "#222222" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).not.toHaveBeenCalled(); // parked, not sent

    // The suspending operation FAILED before any reload (e.g. the POST was refused): the slice is
    // unchanged, so the parked edit saves on resume — losing it would be a silent drop, no notice.
    resume();
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.some((c) => c.name === "Mid-import")).toBe(true);
    detach();
  });

  it("a reload during suspension rebases and saves the parked edit on the imported slice", async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError, onSuccess: onSuccess });
    saveAll.mockClear();
    onSuccess.mockClear();

    const resume = suspendServerWrites();
    useStore.getState().addClient({ name: "Mid-import", color: "#222222" });
    expect(await refreshActiveAccountSlice("a2")).toEqual({ kind: "reloaded" }); // the post-import re-hydrate
    resume();
    await new Promise((r) => setTimeout(r, 5));

    expect(saveAll).toHaveBeenCalledTimes(1);
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.map((c) => c.name)).toEqual([
      "Stark Industries",
      "Internal",
      "Mid-import",
    ]);
    expect(useStore.getState().data.clients.map((c) => c.name)).toEqual(["Stark Industries", "Internal", "Mid-import"]);
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    detach();
  });

  it("resume({dropParkedEdits}) DROPS the parked edit + surfaces it — the import COMMITTED but its re-hydrate failed", async () => {
    // The committed-but-not-reloaded edge: the slice was replaced server-side but the snapshot was
    // never reseeded, so re-saving the parked edit would diff its stale pre-import tree against
    // the stale snapshot and upsert ghost rows into the imported slice (remapped ids → no 409).
    const onError = vi.fn();
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 0, onError: onError });
    saveAll.mockClear();

    const resume = suspendServerWrites();
    useStore.getState().addClient({ name: "Mid-import", color: "#222222" });
    resume({ dropParkedEdits: true });
    await new Promise((r) => setTimeout(r, 5));

    expect(saveAll).not.toHaveBeenCalled(); // never re-scheduled
    expect(onError.mock.calls.some(([e]) => e instanceof ReloadDiscardedEditError)).toBe(true); // surfaced, not silent
    detach();
  });

  it("an edit during the (a′) flush await is parked, rebased after load, and saved", async () => {
    // Pre-fix, an edit arriving while the entry flush was awaited re-armed a debounce timer at
    // depth 0; the timer fired mid-load, its save was silently eaten by the seedGen guard, and the
    // (c) check couldn't see it — a silent loss. The suspension now covers the WHOLE sequence.
    let releaseSave: (() => void) | null = null;
    const slice = a2Slice();
    const loadAll = vi.fn(async () => slice);
    const saveAll = vi.fn((data: AppData) => {
      void data;
      return new Promise<void>((resolve) => {
        releaseSave = () => resolve();
      });
    });
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 300, onError: onError }); // genuinely debounced

    useStore.getState().addClient({ name: "Pre-reload", color: "#222222" }); // pending, debounced
    const refresh = refreshActiveAccountSlice("a2"); // (a′) flushes it → saveAll held open
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1); // the flush is on the wire

    useStore.getState().addClient({ name: "During flush", color: "#333333" }); // arrives mid-flush-await
    await new Promise((r) => setTimeout(r, 350)); // longer than the debounce — a re-armed timer WOULD have fired
    expect(saveAll).toHaveBeenCalledTimes(1); // parked instead

    requireCallback(releaseSave, "pending save release")();
    expect(await refresh).toEqual({ kind: "reloaded" });
    await new Promise((r) => setTimeout(r, 350));
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect((saveAll.mock.calls[1]?.[0] as AppData).clients.some((c) => c.name === "During flush")).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    detach();
  });

  it("a FAILED load re-schedules an edit parked during it — nothing strands unsaved until the next reload", async () => {
    // Pre-fix, a parked edit survived a loadAll throw with no timer, no retry, and
    // failedSinceSuccess=false — the online/visible re-attempts declined it and it sat unsaved
    // indefinitely. The finally-resume re-schedules it: slice + snapshot are unchanged, so the
    // save diffs self-vs-self and is correct.
    let release: (() => void) | null = null;
    let hold = false;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((_resolve, reject) => {
        release = () => reject(new Error("load down"));
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 0, onError: onError });
    saveAll.mockClear();

    hold = true;
    const refresh = refreshActiveAccountSlice("a2");
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().addClient({ name: "Mid-failed-reload", color: "#222222" }); // parked
    requireCallback(release, "failed reload release")();
    expect(await refresh).toEqual({ kind: "failed" });
    await new Promise((r) => setTimeout(r, 5));

    expect(saveAll).toHaveBeenCalledTimes(1); // re-scheduled on resume
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.some((c) => c.name === "Mid-failed-reload")).toBe(true);
    detach();
  });

  it("unload flush still keepalive-pushes an edit parked by a RELOAD suspension — WITHOUT consuming it", async () => {
    // The snapshot is still the pre-reload one until loadAll resolves, so the keepalive diff is
    // self-vs-self and safe — declining (as the external-import guard does) would silently lose
    // the edit on every tab close during a reload window. The edit stays PARKED besides: if the
    // keepalive fails and the page survives (tab merely hidden), the reload's (c) check must
    // still own its fate — consuming it here erased the only remaining record of the edit.
    let release: (() => void) | null = null;
    let hold = false;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((resolve) => {
        release = () => resolve(slice);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 0, onError: onError });
    saveAll.mockClear();

    hold = true;
    const refresh = refreshActiveAccountSlice("a2");
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().addClient({ name: "Mid-reload", color: "#222222" }); // parked
    window.dispatchEvent(new Event("pagehide"));
    expect(saveAll).toHaveBeenCalledTimes(1); // keepalive-flushed, not dropped
    expect(saveAll.mock.calls[0]?.[1]).toEqual({ unload: true });
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.some((c) => c.name === "Mid-reload")).toBe(true);

    requireCallback(release, "reload release")();
    expect(await refresh).toEqual({ kind: "reloaded" });
    // The page survived: the reload rebases the parked edit and performs a normal confirmed save.
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect((saveAll.mock.calls[1]?.[0] as AppData).clients.some((c) => c.name === "Mid-reload")).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    detach();
  });

  it("a failed keepalive during the pre-load window is followed by a normal rebased save", async () => {
    // Pre-fix, the hidden-tab flush CONSUMED `pending` before dataAtLoad was snapshotted; when the
    // swallowed keepalive then failed and the page survived, every signal at (c) read clean and
    // the edit vanished with zero surface.
    let releaseLoad: (() => void) | null = null;
    let hold = false;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((resolve) => {
        releaseLoad = () => resolve(slice);
      });
    });
    const saveAll = vi.fn((_data: AppData, opts?: { unload?: boolean }) =>
      opts?.unload ? Promise.reject(new Error("keepalive dropped")) : Promise.resolve(),
    );
    const onError = vi.fn();
    const detach = await attachActiveA2({
      adapter: { loadAll, saveAll: saveAll as PersistenceAdapter["saveAll"] },
      debounceMs: 0,
      onError: onError,
    });

    hold = true;
    const refresh = refreshActiveAccountSlice("a2");
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().addClient({ name: "Hidden-tab edit", color: "#222222" }); // parked
    window.dispatchEvent(new Event("pagehide")); // keepalive dispatched — and REJECTS

    requireCallback(releaseLoad, "reload release")();
    expect(await refresh).toEqual({ kind: "reloaded" });
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect(requireValue(saveAll.mock.calls[1], "second saveAll call")[1]).toBeUndefined();
    expect((saveAll.mock.calls[1]?.[0] as AppData).clients.some((c) => c.name === "Hidden-tab edit")).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "keepalive dropped" }));
    detach();
  });

  it("a reload superseded by sign-out rebases and saves only the parked edit against the fresh seed", async () => {
    // The null-switch arm bumps the token but loads nothing, so the superseded load's reseed of
    // the adapter snapshot stands. Re-scheduling the whole parked tree would emit DELETEs for rows
    // the reload just fetched, so only the operations made during the network window are rebased
    // onto that seed and saved. The same rebased tree is installed behind the picker while the
    // active account stays null, keeping the adapter snapshot and hidden store paired.
    let release: (() => void) | null = null;
    let hold = false;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((resolve) => {
        release = () => resolve(slice);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 0, onError: onError });
    saveAll.mockClear();

    hold = true;
    const refresh = refreshActiveAccountSlice("a2"); // load held open
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().setActiveAccount(null); // sign-out — token bump, loads nothing
    await new Promise((r) => setTimeout(r, 5));
    // A data write lands while the superseded load is still on the wire (e.g. a mutation that was
    // already dispatched at sign-out) — parked under the refresh's still-held suspension.
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      clients: [
        ...useStore.getState().data.clients,
        {
          id: "stale-c",
          accountId: "a2",
          name: "Stale",
          color: "#1",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });

    requireCallback(release, "refresh release")();
    expect(await refresh).toEqual({ kind: "skipped" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.map((c) => c.id)).toEqual(["c2", "internal:a2", "stale-c"]);
    expect(useStore.getState().activeAccountId).toBeNull();
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["c2", "internal:a2", "stale-c"]);
    expect(onError).not.toHaveBeenCalled();
    detach();
  });

  it("pairs the hidden store with a fresh seed when sign-out supersedes a reload without an edit", async () => {
    let release: (() => void) | null = null;
    let hold = false;
    const fresh = a2Slice();
    fresh.clients = fresh.clients.map((client) =>
      client.id === "c2" ? { ...client, name: "Fresh remote name" } : client,
    );
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(a2Slice());
      return new Promise((resolve) => {
        release = () => resolve(fresh);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 0 });
    saveAll.mockClear();

    hold = true;
    const refresh = refreshActiveAccountSlice("a2");
    await new Promise((resolve) => setTimeout(resolve, 5));
    useStore.getState().setActiveAccount(null);
    requireCallback(release, "refresh release")();

    expect(await refresh).toEqual({ kind: "skipped" });
    expect(useStore.getState().activeAccountId).toBeNull();
    expect(useStore.getState().data.clients.find((client) => client.id === "c2")?.name).toBe("Fresh remote name");
    expect(saveAll).not.toHaveBeenCalled();
    detach();
  });

  it("unload flush DECLINES under an EXTERNAL (import) suspension — the parked edit must not diff a mid-replacement snapshot", async () => {
    const { adapter, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 0 });
    saveAll.mockClear();

    const resume = suspendServerWrites();
    useStore.getState().addClient({ name: "Mid-import", color: "#222222" });
    window.dispatchEvent(new Event("pagehide"));
    expect(saveAll).not.toHaveBeenCalled();
    resume({ dropParkedEdits: true });
    detach();
  });

  it("flushPendingWrites reports NOT clean while suspended (a second import cannot slip in)", async () => {
    const { adapter } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter });
    const resume = suspendServerWrites();
    expect(await flushPendingWrites()).toEqual({ kind: "blocked" });
    resume();
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    detach();
  });

  it("is a no-op (with a no-op resume) when no orchestrator is attached", () => {
    expect(() => suspendServerWrites()()).not.toThrow();
  });
});

describe("mid-reload edits are rebased onto the fresh server slice", () => {
  it("parks an edit during a held-open reload, then installs and saves it after the response", async () => {
    let release: (() => void) | null = null;
    let hold = false;
    const slice = a2Slice();
    const loadAll = vi.fn((): Promise<AppData> => {
      if (!hold) return Promise.resolve(slice);
      return new Promise((resolve) => {
        release = () => resolve(slice);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 0, onError: onError });
    saveAll.mockClear();

    hold = true;
    const refresh = refreshActiveAccountSlice("a2"); // e.g. a focus refresh, held open on the wire
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().addClient({ name: "Mid-reload", color: "#222222" }); // immediate-save mode…
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).not.toHaveBeenCalled(); // …yet nothing was sent: writes are suspended during the load

    requireCallback(release, "refresh release")();
    expect(await refresh).toEqual({ kind: "reloaded" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect((saveAll.mock.calls[0]?.[0] as AppData).clients.map((c) => c.name)).toEqual([
      "Stark Industries",
      "Internal",
      "Mid-reload",
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(useStore.getState().data.clients.map((c) => c.name)).toEqual(["Stark Industries", "Internal", "Mid-reload"]);
    detach();
  });
});
