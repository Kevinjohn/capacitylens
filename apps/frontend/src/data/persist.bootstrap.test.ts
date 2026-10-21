import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { bootstrap } from "./persist";
import { InMemoryDemoAdapter } from "./InMemoryDemoAdapter";
import { LoadError } from "./PersistenceAdapter";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { seed } from "@capacitylens/shared/data/seed";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeAppData, resetStoreWithAccount } from "@/test/fixtures";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";

beforeEach(async () => {
  localStorage.clear();
  // Seed an active account because store additions require an account scope.
  await resetStoreWithAccount();
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

    expect((await adapter.loadAll()).resources.length).toBeGreaterThan(0);
    detach();
  });

  it("does not re-seed after the user has cleared all their data", async () => {
    const adapter = new InMemoryDemoAdapter();
    await adapter.saveAll(emptyAppData());
    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });
    expect(useStore.getState().data.resources).toHaveLength(0);
    detach();
  });

  it("a failing first-run seed write still hydrates, reports via onError, and attaches persistence", async () => {
    const adapter = new InMemoryDemoAdapter();
    const realSave = adapter.saveAll.bind(adapter);
    let calls = 0;
    const errors: unknown[] = [];
    vi.spyOn(adapter, "saveAll").mockImplementation(async (d) => {
      calls += 1;
      if (calls === 1) throw new Error("quota exceeded");
      return realSave(d);
    });

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
      onError: (e) => errors.push(e),
    });

    // Bootstrap leaves company selection at the picker; selecting the seed allows a later edit
    // to prove persistence remains attached after the initial save failure.
    expect(useStore.getState().hydrated).toBe(true);
    expect(errors).toHaveLength(1);

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
            ...NULLABLE_FIELDS.clients,
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

  it("asks the adapter for an empty initial snapshot when skipping the initial read", async () => {
    const loadAll = vi.fn().mockResolvedValue(emptyAppData());
    const adapter: PersistenceAdapter = { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      initialLoad: "empty",
    });
    try {
      expect(loadAll).toHaveBeenCalledWith(undefined, { skipRemoteRead: true });
      expect(useStore.getState().hydrated).toBe(true);
      expect(useStore.getState().data).toEqual(emptyAppData());
    } finally {
      detach();
    }
  });

  it("loads only the validated masquerade account and skips metadata/seed probes", async () => {
    const target = makeAppData({ accounts: [makeAccount({ id: "target-account", name: "Wayne Enterprises" })] });
    const loadAll = vi.fn().mockResolvedValue(target);
    const hasExisting = vi.fn().mockResolvedValue(false);
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, hasExisting, saveAll };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      initialAccountId: "target-account",
      skipExistingCheck: true,
      seedIfEmpty: seed(),
    });

    expect(loadAll).toHaveBeenCalledExactlyOnceWith("target-account");
    expect(hasExisting).not.toHaveBeenCalled();
    expect(saveAll).not.toHaveBeenCalled();
    expect(useStore.getState().data).toEqual(target);
    detach();
  });

  it("reconciles a status-first masquerade summary from the loaded account projection", async () => {
    const accountId = "a-studio";
    const masquerade: MasqueradeState = {
      accountId,
      targetUserId: "target-user",
      targetName: "Clark Kent",
      effectiveRole: "viewer",
      startedAt: "2026-09-01T10:00:00.000Z",
      token: "session-token",
    };
    useStore.getState().setMasquerade({ kind: "active", state: masquerade, generation: 1 });
    useStore.getState().setAccountSummaries({
      list: [{ id: accountId, name: masquerade.targetName, role: masquerade.effectiveRole }],
    });
    const loadAll = vi
      .fn()
      .mockResolvedValue(makeAppData({ accounts: [makeAccount({ id: accountId, name: "Wayne Enterprises" })] }));
    const hasExisting = vi.fn();
    const adapter: PersistenceAdapter = { loadAll, hasExisting, saveAll: vi.fn().mockResolvedValue(undefined) };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      initialAccountId: accountId,
      skipExistingCheck: true,
    });

    try {
      expect(loadAll).toHaveBeenCalledExactlyOnceWith(accountId);
      expect(hasExisting).not.toHaveBeenCalled();
      expect(useStore.getState().accountSummaries).toEqual([
        { id: accountId, name: "Wayne Enterprises", role: "viewer" },
      ]);
    } finally {
      detach();
      useStore.getState().setMasquerade({ kind: "inactive" });
    }
  });

  it("keeps loaded data and attaches persistence when hasExisting() throws after a successful load", async () => {
    // Server mode: /api/state succeeds but /api/meta has a transient blip. The loaded data
    // must not be discarded and saving must not be bricked by the hasExisting() throw.
    const loaded = makeAppData({
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
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
    expect(useStore.getState().data.clients).toHaveLength(1);
    expect(useStore.getState().data.clients[0]?.name).toBe("Loaded");
    expect(useStore.getState().data.resources).toHaveLength(0);

    useStore.getState().addClient({ name: "Later", color: "#222222" });
    await vi.waitFor(() => expect(saveAll).toHaveBeenCalled());
    detach();
  });
  it("flags connectionError (not loadError) and attaches no persistence when a remote load is unavailable", async () => {
    useStore.getState().setLoadError(false);
    useStore.getState().setConnectionError(false);
    const saveAll = vi.fn().mockResolvedValue(undefined);

    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.reject(new LoadError("unavailable", "server down")),
      saveAll,
    };

    const detach = await bootstrap(useStore, adapter, {
      debounceMs: 0,
      seedIfEmpty: seed(),
    });

    expect(useStore.getState().connectionError).toBe(true);
    expect(useStore.getState().loadError).toBe(false);
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data.resources).toHaveLength(0);

    // No autosave attached: an edit must not be pushed as a destructive diff to a
    // server that merely returned once.
    useStore.getState().addAccount({ name: "New", color: "#111111" });
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
    expect(saveAll).not.toHaveBeenCalled();
    useStore.getState().setLoadError(false);
    detach();
  });
});
