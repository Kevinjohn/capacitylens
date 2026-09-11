import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, refreshActiveAccountSlice } from "./persist";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { resetStoreWithAccount } from "../test/fixtures";
import {
  requireCallback,
  makeLocalTwoAccounts,
  recordingAdapter,
  a2Slice,
  accountSwitchSlices,
  attachActiveA2,
} from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

describe("refresh-on-focus (P1.16, server mode)", () => {
  // Coming back to the tab/window re-hydrates the active account's slice by REUSING refreshActive
  // (the switch orchestrator's body) — so the adapter's private lastSynced snapshot is re-seeded
  // atomically with `data`. Proven here against a recording adapter + window 'focus' events (the
  // same shape as the pagehide tests above). Uses the module-scope recordingAdapter / a2Slice /
  // attachActiveA2 helpers (shared with the refreshActiveAccountSlice + batch-conflict suites).

  it("re-hydrates the active slice on focus + re-seeds the snapshot (a later save diffs to ZERO ops)", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter });
    const loadsAfterPick = loadAll.mock.calls.length; // the switch already loaded once
    saveAll.mockClear();

    // The switch itself counts as the latest successful refresh. Move beyond that interval before
    // exercising the ordinary focus re-hydration path.
    now.mockReturnValue(131_000);
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 5));

    expect(loadAll).toHaveBeenCalledWith("a2"); // re-hydrated the active account
    expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
    // The re-hydration re-seeds lastSynced atomically: loading the same slice it already holds is
    // NOT a user edit, so it must NOT push a save back.
    expect(saveAll).not.toHaveBeenCalled();
    detach();
    now.mockRestore();
  });

  it("preserves undo history when focus republishes the same authoritative revisions", async () => {
    let remote = a2Slice();
    const loadAll = vi.fn(async () => structuredClone(remote));
    const saveAll = vi.fn(async (data: AppData) => {
      remote = structuredClone(data);
    });
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll } });

    useStore.getState().addClient({ name: "Undo me", color: "#222222" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(useStore.getState().past).toHaveLength(1);

    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().data.clients.some((client) => client.name === "Undo me")).toBe(false);
    detach();
  });

  it("does not duplicate the successful slice load when focus follows a company switch", async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter });
    const loadsAfterPick = loadAll.mock.calls.length;

    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(loadAll.mock.calls.length).toBe(loadsAfterPick);
    detach();
  });

  it("THROTTLES through the exact 30-second focus interval boundary", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const { adapter, loadAll } = recordingAdapter(a2Slice());
      const detach = await attachActiveA2({ adapter: adapter });
      const before = loadAll.mock.calls.length;

      now.mockReturnValue(129_999);
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loadAll.mock.calls.length).toBe(before);

      now.mockReturnValue(130_000);
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loadAll.mock.calls.length).toBe(before);

      now.mockReturnValue(130_001);
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loadAll.mock.calls.length).toBe(before + 1);
      detach();
    } finally {
      now.mockRestore();
    }
  });

  it("detach prevents an in-flight focus refresh from installing its late slice", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const initial = a2Slice();
    const late = { ...a2Slice(), clients: [] };
    let release!: () => void;
    let hold = false;
    const loadAll = vi.fn(() => {
      if (!hold) return Promise.resolve(initial);
      return new Promise<AppData>((resolve) => {
        release = () => resolve(late);
      });
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll } });

    hold = true;
    now.mockReturnValue(131_000);
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(release).toBeTypeOf("function");
    detach();
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(
      useStore
        .getState()
        .data.clients.map((client) => client.id)
        .sort(),
    ).toEqual(initial.clients.map((client) => client.id).sort());
    now.mockRestore();
  });

  it("periodically re-hydrates a continuously visible server session", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, loadAll } = recordingAdapter(a2Slice());
      const detachPromise = attachActiveA2({ adapter: adapter });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachPromise;
      const loadsAfterPick = loadAll.mock.calls.length;

      await vi.advanceTimersByTimeAsync(59_000);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);

      detach();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll while hidden and refreshes when the tab becomes visible", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const { adapter, loadAll } = recordingAdapter(a2Slice());
      const detachPromise = attachActiveA2({ adapter: adapter });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachPromise;
      const loadsAfterPick = loadAll.mock.calls.length;

      await vi.advanceTimersByTimeAsync(120_000);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick);

      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      detach();
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("SKIPS refresh when there is no active account (on the picker)", async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice());
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: true,
    });
    // No account picked → still on the picker.
    loadAll.mockClear();

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 5));

    expect(loadAll).not.toHaveBeenCalled(); // nothing to refresh
    detach();
  });

  it("FLUSHES a pending debounced edit BEFORE the focus refetch (user edit lands first)", async () => {
    // The unsaved-edit safety: a pending debounced edit + a focus must POST that edit BEFORE loadAll
    // re-seeds the snapshot (last-writer-wins, user wins). Order-assert on the recorded call sequence.
    const order: string[] = [];
    const loadAll = vi.fn(async () => {
      order.push("loadAll");
      return a2Slice();
    });
    const saveAll = vi.fn(async () => {
      order.push("saveAll");
    });
    const adapter: PersistenceAdapter = { loadAll, saveAll };
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300 }); // genuinely debounced
    order.length = 0; // ignore the initial switch's loadAll

    useStore.getState().addClient({ name: "Unsaved", color: "#222222" }); // debounced — not yet on the wire
    expect(saveAll).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20)); // < 300ms: a dropped edit's timer would NOT fire

    // The edit's save flushed BEFORE the refresh loadAll (no cross-account / lost-edit window).
    expect(order[0]).toBe("saveAll");
    expect(order).toContain("loadAll");
    expect(order.indexOf("saveAll")).toBeLessThan(order.indexOf("loadAll"));
    detach();
  });

  it("is INERT in the demo build — focus does NOT call loadAll", async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice());
    useStore.getState().replaceAll(makeLocalTwoAccounts());
    useStore.getState().setActiveAccount("a1");
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: false,
    }); // demo build
    loadAll.mockClear();

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 5));

    expect(loadAll).not.toHaveBeenCalled(); // local holds every account — no refetch
    detach();
  });

  it("ABORTS the focus refresh while a save is FAILED — the un-persisted edit must not be clobbered", async () => {
    // The data-loss trap: an edit's save fails (retry scheduled), the user tabs away and back, and the
    // focus refresh loadAll+replaceAll's the SERVER's copy over the optimistic state — re-seeding the
    // snapshot so the pending retry diffs to ZERO ops, "succeeds", and the edit is silently gone
    // forever. The refresh must abort instead: the retry machinery still holds the edit, and the
    // persist banner (onError) already tells the user they're unsynced.
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter }); // debounceMs 0 — saves fire immediately
    const loadsAfterPick = loadAll.mock.calls.length;
    saveAll.mockRejectedValue(new Error("write unavailable")); // every save now fails

    useStore.getState().addClient({ name: "Unsynced", color: "#222222" });
    await new Promise((r) => setTimeout(r, 5)); // let the immediate save fail (failedSinceSuccess set)

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 5));

    expect(loadAll.mock.calls.length).toBe(loadsAfterPick); // NO reload — the refresh aborted
    // The optimistic edit is still in the store, available to the retry/stranded-write machinery.
    expect(useStore.getState().data.clients.some((c) => c.name === "Unsynced")).toBe(true);
    detach();
  });

  it("retries a stranded write on focus without throttling the next visible recovery", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      let remote = a2Slice();
      let writable = false;
      const loadAll = vi.fn(async () => remote);
      const saveAll = vi.fn(async (data: AppData) => {
        if (!writable) throw new Error("write unavailable");
        remote = data;
      });
      const detachPromise = attachActiveA2({ adapter: { loadAll, saveAll } });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachPromise;
      const loadsAfterPick = loadAll.mock.calls.length;

      useStore.getState().addClient({ name: "Stranded", color: "#222222" });
      await vi.advanceTimersByTimeAsync(31_000); // initial attempt + 1/2/4/8/16s retries all fail
      const savesAfterBudget = saveAll.mock.calls.length;

      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(saveAll.mock.calls.length).toBe(savesAfterBudget + 1);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick);

      writable = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);

      expect(saveAll.mock.calls.length).toBe(savesAfterBudget + 2);
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      expect(remote.clients.some((client) => client.name === "Stranded")).toBe(true);
      detach();
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a failed-save focus refresh does not orphan an in-flight company switch", async () => {
    const { aSlice, bSlice } = accountSwitchSlices();
    let releaseB: (() => void) | null = null;
    const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
      if (accountId === "b1") {
        return new Promise((resolve) => {
          releaseB = () => resolve(bSlice);
        });
      }
      return Promise.resolve(aSlice);
    });
    let rejectSaves = false;
    const saveAll = vi.fn(async () => {
      if (rejectSaves) throw new Error("write unavailable");
    });

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll },
      debounceMs: 0,
      serverMode: true,
    });
    useStore.getState().setActiveAccount("a1");
    await new Promise((resolve) => setTimeout(resolve, 5));

    rejectSaves = true;
    useStore.getState().addClient({ name: "Unsynced in A", color: "#222222" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    useStore.getState().setActiveAccount("b1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(releaseB).not.toBeNull();

    // The focus refresh sees B active but must not supersede B's already-running load merely to
    // abort on A's failed-save flag. Otherwise the adapter snapshot becomes B while data stays A.
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    requireCallback(releaseB, "account B load release")();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(useStore.getState().activeAccountId).toBe("b1");
    expect(useStore.getState().data.accounts.map((account) => account.id)).toEqual(["b1"]);
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["cb"]);
    detach();
  });
});

async function attachHeldAccountSwitch() {
  const { aSlice, bSlice } = accountSwitchSlices();
  let release: (() => void) | null = null;
  const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
    if (accountId !== "b1") return Promise.resolve(aSlice);
    return new Promise<AppData>((resolve) => {
      release = () => resolve(bSlice);
    });
  });
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries([
    { id: "a1", name: "Alpha", role: "owner" },
    { id: "b1", name: "Beta", role: "owner" },
  ]);
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
    debounceMs: 0,
    serverMode: true,
  });
  useStore.getState().setActiveAccount("a1");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const readReleaseB = () => release;
  return { detach, loadAll, readReleaseB };
}

describe("refreshActiveAccountSlice (the lifecycle hook reload seam)", () => {
  // The out-of-band server writers (archive/delete/purge routes) reload the active slice THROUGH the
  // orchestrator via this export — a bare loadAll+replaceAll would clobber a still-debounced edit and
  // re-seed the snapshot under it (the same permanent-loss mechanism the focus-refresh abort guards).
  // Uses the module-scope recordingAdapter / a2Slice / attachActiveA2 helpers.

  it("returns 'unattached' when no orchestrator is attached (the caller falls back to a bare reload)", async () => {
    expect(await refreshActiveAccountSlice("a2")).toEqual({ kind: "unattached" });
  });

  it("FLUSHES a pending debounced edit BEFORE reloading (returns 'reloaded'; the edit lands first)", async () => {
    const order: string[] = [];
    const loadAll = vi.fn(async () => {
      order.push("loadAll");
      return a2Slice();
    });
    const saveAll = vi.fn(async () => {
      order.push("saveAll");
    });
    const adapter: PersistenceAdapter = { loadAll, saveAll };
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300 }); // genuinely debounced
    order.length = 0; // ignore the initial switch's loadAll

    useStore.getState().addClient({ name: "Mid-debounce", color: "#222222" }); // not yet on the wire
    expect(await refreshActiveAccountSlice("a2")).toEqual({ kind: "reloaded" });

    expect(order[0]).toBe("saveAll"); // the edit POSTed before the reload re-seeded the snapshot
    expect(order).toContain("loadAll");
    detach();
  });

  it("SKIPS the reload when the flush FAILS — preserving the edit beats reflecting the mutation", async () => {
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300 });
    const loadsAfterPick = loadAll.mock.calls.length;
    saveAll.mockRejectedValue(new Error("write unavailable"));

    useStore.getState().addClient({ name: "Unsynced", color: "#222222" });
    expect(await refreshActiveAccountSlice("a2")).toEqual({ kind: "skipped" }); // the orchestrator DECLINED, honestly…

    expect(loadAll.mock.calls.length).toBe(loadsAfterPick); // …which refused to clobber the edit
    expect(useStore.getState().data.clients.some((c) => c.name === "Unsynced")).toBe(true);
    detach();
  });

  it("with a STALE id is a no-op and does NOT cancel an in-flight newer switch (wrong-tenant race)", async () => {
    // The P1 race: a lifecycle POST for account A resolves AFTER the user switched A→B while B's
    // slice load is still on the wire. Pre-fix, the stale refreshActive(A) bumped the switch token —
    // CANCELLING B's late-resolving load — then installed A's slice while activeAccountId === B
    // (cross-tenant display → cross-tenant writes). The entry guard must make the stale call a
    // pure no-op: no loadAll(A), no token bump, and B's held-open load still lands.
    const { detach, loadAll, readReleaseB } = await attachHeldAccountSwitch();
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["ca"]);

    useStore.getState().setActiveAccount("b1"); // switch — B's load is now held open
    await new Promise((r) => setTimeout(r, 5));
    const releaseB = readReleaseB();
    expect(releaseB).not.toBeNull(); // B's loadAll dispatched, unresolved
    const aLoadsBefore = loadAll.mock.calls.filter((c) => c[0] === "a1").length;

    // The lifecycle hook's stale reload lands NOW (mutation ran in A; user is on B).
    expect(await refreshActiveAccountSlice("a1")).toEqual({ kind: "skipped" }); // stale id — declined, honestly…
    expect(loadAll.mock.calls.filter((c) => c[0] === "a1").length).toBe(aLoadsBefore); // …as a no-op

    // B's in-flight load was NOT cancelled: when it resolves, B's slice still lands.
    requireCallback(releaseB, "account B load release")();
    await new Promise((r) => setTimeout(r, 5));
    expect(useStore.getState().activeAccountId).toBe("b1");
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["cb"]); // B's slice, never A's
    detach();
  });

  it("is UNREGISTERED after detach (a later call falls back)", async () => {
    const { adapter } = recordingAdapter(a2Slice());
    const detach = await attachActiveA2({ adapter: adapter });
    detach();
    expect(await refreshActiveAccountSlice("a2")).toEqual({ kind: "unattached" });
  });
});
