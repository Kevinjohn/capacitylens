import { describe, it, expect, beforeEach, vi } from "vitest";
import { bootstrap } from "./persist";
import { InMemoryDemoAdapter } from "./InMemoryDemoAdapter";
import { LoadError, type PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { seed } from "@capacitylens/shared/data/seed";
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from "../test/fixtures";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

describe("bootstrap", () => {
  it("seeds an empty store and marks it hydrated", async () => {
    const adapter = new InMemoryDemoAdapter();
    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0);
    // the seed is also persisted on first run
    expect((await adapter.loadAll()).resources.length).toBeGreaterThan(0);
    detach();
  });

  it("does not re-seed after the user has cleared all their data", async () => {
    const adapter = new InMemoryDemoAdapter();
    await adapter.saveAll(emptyAppData()); // user deleted everything; empty IS persisted
    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });
    expect(useStore.getState().data.resources).toHaveLength(0); // seed must NOT come back
    detach();
  });

  it("a failing first-run seed write still hydrates, reports via onError, and attaches persistence", async () => {
    const adapter = new InMemoryDemoAdapter();
    const realSave = adapter.saveAll.bind(adapter);
    let calls = 0;
    const errors: unknown[] = [];
    vi.spyOn(adapter, "saveAll").mockImplementation(async (d) => {
      calls += 1;
      if (calls === 1) throw new Error("quota exceeded"); // the seed write fails
      return realSave(d);
    });

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
      onError: (e) => errors.push(e),
    });

    expect(useStore.getState().hydrated).toBe(true); // app still renders
    expect(errors).toHaveLength(1); // the failure surfaced (would flip the banner)
    // Bootstrap deliberately leaves company selection at the picker. Choose the seeded tenant, then
    // prove persistence is STILL attached: a later edit persists via the now-working adapter.
    const seededAccount = useStore.getState().data.accounts[0];
    if (!seededAccount) throw new Error("expected bootstrap to retain the seeded account");
    useStore.getState().setActiveAccount(seededAccount.id);
    useStore.getState().addClient({ name: "Later", color: "#1" });
    expect((await adapter.loadAll()).clients.some((c) => c.name === "Later")).toBe(true);
    detach();
  });
  it("loads existing data without re-seeding", async () => {
    const adapter = new InMemoryDemoAdapter();
    await adapter.saveAll(
      makeAppData({
        clients: [
          {
            id: "c1",
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: "t",
            updatedAt: "t",
            name: "Saved",
            color: "#1",
          },
        ],
      }),
    );
    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });
    expect(useStore.getState().data.clients).toHaveLength(1);
    expect(useStore.getState().data.clients[0]?.name).toBe("Saved");
    expect(useStore.getState().data.resources).toHaveLength(0);
    detach();
  });

  it("keeps loaded data and attaches persistence when hasExisting() throws after a successful load", async () => {
    // Server mode: /api/state succeeds but /api/meta has a transient blip. The loaded data
    // must NOT be discarded and saving must NOT be bricked by the hasExisting() throw.
    const loaded = makeAppData({
      clients: [
        {
          id: "c1",
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt: "t",
          updatedAt: "t",
          name: "Loaded",
          color: "#1",
        },
      ],
    });
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.resolve(loaded),
      saveAll,
      hasExisting: () => Promise.reject(new Error("meta blip")),
    };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });

    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data.clients).toHaveLength(1); // loaded data kept, not discarded
    expect(useStore.getState().data.clients[0]?.name).toBe("Loaded");
    expect(useStore.getState().data.resources).toHaveLength(0); // NOT re-seeded (data exists)

    // Persistence IS attached: a later edit still saves.
    useStore.getState().addClient({ name: "Later", color: "#222222" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).toHaveBeenCalled();
    detach();
  });
  it("flags connectionError (not loadError) and attaches no persistence when a remote load is unavailable", async () => {
    useStore.getState().setLoadError(false);
    useStore.getState().setConnectionError(false);
    const saveAll = vi.fn().mockResolvedValue(undefined);
    // A server-backed adapter whose load fails (server down / network error).
    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.reject(new LoadError("unavailable", "server down")),
      saveAll,
    };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });

    // Routed to the retry screen, NOT the corrupt-data reset UI.
    expect(useStore.getState().connectionError).toBe(true);
    expect(useStore.getState().loadError).toBe(false);
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data.resources).toHaveLength(0); // rendered empty, not seeded

    // No autosave attached: an edit must not be pushed as a destructive diff to a
    // server that merely returned once.
    useStore.getState().addAccount({ name: "New", color: "#111111" });
    await new Promise((r) => setTimeout(r, 5));
    expect(saveAll).not.toHaveBeenCalled();

    useStore.getState().setConnectionError(false);
    detach();
  });

  it.each([
    ["a corrupt LoadError", new LoadError("corrupt", "bad bytes")],
    ["a plain Error", new Error("unexpected load failure")],
  ])("routes %s to storage recovery rather than the connection screen", async (_label, failure) => {
    useStore.getState().setLoadError(false);
    useStore.getState().setConnectionError(false);
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = await bootstrap(
      useStore,
      { loadAll: () => Promise.reject(failure), saveAll },
      { debounceMs: 0, seedIfEmpty: seed() },
    );

    expect(useStore.getState().loadError).toBe(true);
    expect(useStore.getState().connectionError).toBe(false);
    useStore.getState().addAccount({ name: "Unsaved", color: "#111111" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).not.toHaveBeenCalled();
    useStore.getState().setLoadError(false);
    detach();
  });
});
