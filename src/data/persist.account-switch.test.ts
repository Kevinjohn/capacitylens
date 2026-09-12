import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, retryActiveAccountLoad, switchAndAwaitHydration } from "./persist";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount } from "../test/fixtures";
import { internalClient, requireCallback, makeLocalTwoAccounts, accountSwitchSlices } from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

interface AccountSwitchWireEntry {
  url: string;
  ops?: Array<{
    method: string;
    table: string;
    id: string;
    accountId?: string;
    row?: { accountId?: string; createdAt?: string; updatedAt?: string };
  }>;
}

function recordingAccountSwitchAdapter() {
  const slice = (accountId: string, name: string) => ({
    ...emptyAppData(),
    accounts: [{ id: accountId, name, color: "#1", createdAt: "t", updatedAt: "t" }],
    clients: [internalClient(accountId)],
  });
  const aSlice = slice("a1", "Alpha");
  const bSlice = slice("b1", "Beta");
  const wire: AccountSwitchWireEntry[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    if (requestUrl.includes("/api/state")) {
      wire.push({ url: requestUrl });
      return new Response(JSON.stringify(requestUrl.includes("accountId=b1") ? bSlice : aSlice), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { ops: AccountSwitchWireEntry["ops"] };
    wire.push(body.ops === undefined ? { url: requestUrl } : { url: requestUrl, ops: body.ops });
    return new Response(
      JSON.stringify({
        ok: true,
        applied: body.ops?.length ?? 0,
        revisions: (body.ops ?? [])
          .filter((operation) => operation.method === "PUT")
          .map((operation) => ({
            table: operation.table,
            id: operation.id,
            createdAt: operation.row?.createdAt ?? "t",
            updatedAt: operation.row?.updatedAt ?? "t",
          })),
      }),
      { status: 200 },
    );
  });
  return { adapter: new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch), wire };
}

describe("account-switch orchestrator (P1.13, server mode)", () => {
  it("blocks writes after a failed switch hydration and recovers through an explicit retry", async () => {
    const { aSlice, bSlice } = accountSwitchSlices();
    const loadAll = vi
      .fn<(accountId?: string) => Promise<AppData>>()
      .mockResolvedValueOnce(aSlice)
      .mockRejectedValueOnce(new Error("B unavailable"))
      .mockResolvedValueOnce(bSlice);
    const saveAll = vi.fn().mockResolvedValue(undefined);
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
      onError: vi.fn(),
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "failed" });
    expect(useStore.getState().activeAccountLoadFailed).toBe("b1");
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["ca"]);
    expect(() => useStore.getState().addClient({ name: "Blocked", color: "#222222" })).toThrow(/not loaded/i);
    expect(saveAll).not.toHaveBeenCalled();

    await expect(retryActiveAccountLoad("b1")).resolves.toEqual({ kind: "reloaded" });
    expect(useStore.getState().activeAccountLoadFailed).toBeNull();
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["cb"]);
    useStore.getState().addClient({ name: "Recovered", color: "#222222" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);
    detach();
  });

  it("retries a failed hydration even when the previous account save failed", async () => {
    const { aSlice, bSlice } = accountSwitchSlices();
    const loadAll = vi
      .fn<(accountId?: string) => Promise<AppData>>()
      .mockResolvedValueOnce(aSlice)
      .mockRejectedValueOnce(new Error("B unavailable"))
      .mockResolvedValueOnce(bSlice);
    const saveAll = vi.fn().mockRejectedValueOnce(new Error("A save failed")).mockResolvedValue(undefined);
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
      onError: vi.fn(),
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    useStore.getState().addClient({ name: "Unsaved A", color: "#222222" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "failed" });
    await expect(retryActiveAccountLoad("b1")).resolves.toEqual({ kind: "reloaded" });

    expect(loadAll).toHaveBeenCalledTimes(3);
    expect(useStore.getState().activeAccountLoadFailed).toBeNull();
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["cb"]);
    detach();
  });

  it("clears a failed hydration when a newer company switch succeeds", async () => {
    const { aSlice } = accountSwitchSlices();
    const cSlice = {
      ...emptyAppData(),
      accounts: [{ id: "c1", name: "Gamma", color: "#1", createdAt: "t", updatedAt: "t" }],
    };
    const loadAll = vi.fn(async (accountId?: string) => {
      if (accountId === "a1") return aSlice;
      if (accountId === "b1") throw new Error("B unavailable");
      return cSlice;
    });
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
      { id: "c1", name: "Gamma", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
      debounceMs: 0,
      onError: vi.fn(),
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "failed" });
    expect(useStore.getState().activeAccountLoadFailed).toBe("b1");
    await expect(switchAndAwaitHydration("c1")).resolves.toEqual({ kind: "reloaded" });
    expect(useStore.getState().activeAccountLoadFailed).toBeNull();
    expect(useStore.getState().activeAccountId).toBe("c1");
    expect(useStore.getState().data.accounts[0]?.id).toBe("c1");
    detach();
  });

  // The §5 correctness core at the persist layer: a tenant switch hydrates THAT account's slice and
  // re-seeds the adapter's diff snapshot atomically, with NO spurious save of the loaded slice.
  it("lets the account-transition owner await the subscriber's exact hydration, including null", async () => {
    let resolveLoad!: (data: AppData) => void;
    const load = new Promise<AppData>((resolve) => {
      resolveLoad = resolve;
    });
    const adapter: PersistenceAdapter = {
      loadAll: vi.fn(async () => load),
      saveAll: vi.fn(async () => {}),
    };
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: true,
    });

    const switching = switchAndAwaitHydration("a2");
    let settled = false;
    void switching.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveLoad({
      ...emptyAppData(),
      accounts: [{ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
    });
    await expect(switching).resolves.toEqual({ kind: "reloaded" });
    await expect(switchAndAwaitHydration(null)).resolves.toEqual({ kind: "reloaded" });
    expect(useStore.getState().activeAccountId).toBeNull();
    detach();
  });

  it("settles an outstanding account transition when its persistence owner detaches", async () => {
    const load = new Promise<AppData>(() => undefined);
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: vi.fn(async () => load), saveAll: vi.fn(async () => {}) },
      debounceMs: 0,
      serverMode: true,
    });

    const switching = switchAndAwaitHydration("a2");
    detach();

    await expect(switching).resolves.toEqual({ kind: "unattached" });
  });

  it("loads the picked account slice into the store and does NOT push it back as a save", async () => {
    const a2Slice = {
      ...emptyAppData(),
      accounts: [{ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
      clients: [
        {
          id: "c2",
          accountId: "a2",
          name: "Beta Client",
          color: "#1",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    };
    const loadAll = vi.fn(async (accountId?: string) => (accountId === "a2" ? a2Slice : emptyAppData()));
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };

    // Server-mode attach with an empty store (the pre-pick state in auth-on).
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: true,
    });

    // Pick a2 (existence via the summary) → the orchestrator loads a2's slice.
    useStore.getState().setActiveAccount("a2");
    await new Promise((r) => setTimeout(r, 5));

    expect(loadAll).toHaveBeenCalledWith("a2"); // per-account hydration
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["c2"]); // slice loaded into the store
    // The slice load must NOT read as a user edit → no save of the loaded slice.
    expect(saveAll).not.toHaveBeenCalled();
    detach();
  });

  it("a genuine edit AFTER a switch still saves (the guard only suppresses the slice load)", async () => {
    const a2Slice = {
      ...emptyAppData(),
      accounts: [{ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
    };
    const loadAll = vi.fn(async () => a2Slice);
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: true,
    });

    useStore.getState().setActiveAccount("a2");
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).not.toHaveBeenCalled(); // the load itself didn't save

    // A real edit in the now-active account DOES save.
    useStore.getState().addClient({ name: "New Client", color: "#222222" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalledTimes(1);
    detach();
  });

  it("FLUSHES (does not drop) account A's pending debounced edits before loading B's slice", async () => {
    // Regression guard for the data-loss edge (P1.13): a user edits account A and switches to B
    // WITHIN the debounce window. The orchestrator used to clearTimeout + pending=null, silently
    // DROPPING A's last edit. It must instead FLUSH that pending write while data===A AND the diff
    // snapshot===A (so the diff is A-vs-A, correct), landing it BEFORE B's slice load reseeds the
    // snapshot to B — never a cross-account diff. Uses the REAL ServerSyncAdapter so the actual
    // diff/snapshot logic runs against a fake fetch; we assert on the wire traffic.
    const { adapter, wire } = recordingAccountSwitchAdapter();

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 300,
      serverMode: true,
    }); // genuinely debounced

    // Pick A → orchestrator hydrates A's slice (snapshot := A).
    useStore.getState().setActiveAccount("a1");
    await new Promise((r) => setTimeout(r, 5));
    expect(useStore.getState().activeAccountId).toBe("a1");

    // Genuine edit to A → DEBOUNCED (not yet on the wire). Capture its id to find it later.
    const edited = useStore.getState().addClient({ name: "A only", color: "#222222" });
    expect(wire.some((w) => w.ops)).toBe(false); // nothing flushed yet — still inside the 300ms window

    // Switch to B BEFORE the debounce timer fires → must FLUSH A's edit, then load B.
    useStore.getState().setActiveAccount("b1");
    await new Promise((r) => setTimeout(r, 20)); // < 300ms, so a dropped edit would NOT have its timer fire

    // A's edit reached the adapter (flushed, not dropped): a batch carrying A's client (a PUT, so
    // its accountId rides on the row — DELETEs carry a top-level accountId, PUTs carry the full row).
    const carriesA = (o: NonNullable<AccountSwitchWireEntry["ops"]>[number]) =>
      o.row?.accountId === "a1" || o.accountId === "a1";
    const aBatchIdx = wire.findIndex((w) => w.ops?.some((o) => o.id === edited.id && carriesA(o)));
    expect(aBatchIdx).toBeGreaterThanOrEqual(0);
    // And it landed BEFORE B's slice load (no window where a diff could cross accounts).
    const bLoadIdx = wire.findIndex((w) => w.url.includes("accountId=b1"));
    expect(bLoadIdx).toBeGreaterThanOrEqual(0);
    expect(aBatchIdx).toBeLessThan(bLoadIdx);

    // After B loaded, NO batch carries A's ops (no cross-account diff B-vs-A).
    const afterB = wire.slice(bLoadIdx);
    expect(afterB.some((w) => w.ops?.some(carriesA))).toBe(false);
    expect(useStore.getState().activeAccountId).toBe("b1");
    detach();
  });

  it("rebases an edit landing while a switch load is in flight onto the newly active account", async () => {
    const { aSlice, bSlice } = accountSwitchSlices();
    let releaseB: (() => void) | null = null;
    const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
      if (accountId === "b1") {
        return new Promise<AppData>((resolve) => {
          releaseB = () => resolve(bSlice);
        });
      }
      return Promise.resolve(aSlice);
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };
    const onError = vi.fn();

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 300,
      onError: onError,
      serverMode: true,
    }); // debounced

    useStore.getState().setActiveAccount("a1");
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().setActiveAccount("b1"); // B's load held open
    await new Promise((r) => setTimeout(r, 5));
    expect(releaseB).not.toBeNull();

    // Edit lands mid-switch (still inside the debounce window when B's slice arrives).
    const edit = useStore.getState().addClient({ name: "Mid-switch edit", color: "#222222" });
    saveAll.mockClear();
    requireCallback(releaseB, "account B load release")();
    await new Promise((r) => setTimeout(r, 5));

    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["cb", edit.id]);
    expect(useStore.getState().data.clients.find((c) => c.id === edit.id)?.accountId).toBe("b1");
    expect(onError).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 400));
    expect(saveAll).toHaveBeenCalledTimes(1);
    const saved = saveAll.mock.calls[0]?.[0] as AppData;
    expect(saved.clients.map((c) => c.id)).toEqual(["cb", edit.id]);
    expect(saved.clients.every((c) => c.accountId === "b1")).toBe(true);
    detach();
  });

  it("is INERT in the demo build — a switch does NOT call loadAll(accountId)", async () => {
    const loadAll = vi.fn(async () => emptyAppData());
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };

    useStore.getState().replaceAll(makeLocalTwoAccounts());
    useStore.getState().setActiveAccount("a1");
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: false,
    }); // demo build

    useStore.getState().setActiveAccount("a2");
    await new Promise((r) => setTimeout(r, 5));
    // Demo build: data already holds all accounts, so the orchestrator never fetches a slice.
    expect(loadAll).not.toHaveBeenCalled();
    detach();
  });
});
