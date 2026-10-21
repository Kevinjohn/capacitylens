import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, flushPendingWrites, retryActiveAccountLoad, switchAndAwaitHydration } from "./persist";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { makeAccount, resetStoreWithAccount } from "@/test/fixtures";
import { internalClient, requireCallback, makeLocalTwoAccounts, accountSwitchSlices } from "./__tests__/persistTestKit";

beforeEach(async () => {
  localStorage.clear();
  // Seed an active account because store additions require an account scope.
  await resetStoreWithAccount();
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
    accounts: [{ ...NULLABLE_FIELDS.accounts, id: accountId, name, color: "#1", createdAt: "t", updatedAt: "t" }],
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

async function attachFailedSwitchWithParkedEdit() {
  const { aSlice } = accountSwitchSlices();
  let rejectB!: (error: Error) => void;
  let resolveBStarted!: () => void;
  const bStarted = new Promise<void>((resolve) => {
    resolveBStarted = resolve;
  });
  const loadAll = vi
    .fn<(accountId?: string) => Promise<AppData>>()
    .mockResolvedValueOnce(aSlice)
    .mockImplementationOnce(
      () =>
        new Promise<AppData>((_resolve, reject) => {
          resolveBStarted();
          rejectB = reject;
        }),
    );
  const saveAll = vi.fn().mockResolvedValue(undefined);
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries({
    list: [
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ],
  });
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll, saveAll },
    debounceMs: 0,
    onError: vi.fn(),
    serverMode: true,
  });
  await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
  const switching = switchAndAwaitHydration("b1");
  await bStarted;
  useStore.getState().addClient({ name: "Parker Industries", color: "#222222" });
  rejectB(new Error("B unavailable"));
  await expect(switching).resolves.toEqual({ kind: "failed" });
  return { detach, saveAll };
}

describe("account-switch orchestrator (P1.13, server mode)", () => {
  it("does not flush a failed-load edit when the document becomes hidden", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { detach, saveAll } = await attachFailedSwitchWithParkedEdit();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(saveAll).not.toHaveBeenCalled();
    visibility.mockRestore();
    detach();
  });

  it("does not send a failed-load edit during page teardown", async () => {
    const { detach, saveAll } = await attachFailedSwitchWithParkedEdit();

    window.dispatchEvent(new Event("pagehide"));

    expect(saveAll).not.toHaveBeenCalled();
    detach();
  });

  it("discards a failed-load edit instead of sending it when returning to the picker", async () => {
    const { detach, saveAll } = await attachFailedSwitchWithParkedEdit();

    await expect(switchAndAwaitHydration(null)).resolves.toEqual({ kind: "reloaded" });

    expect(useStore.getState().activeAccountId).toBeNull();
    expect(saveAll).not.toHaveBeenCalled();
    detach();
  });

  it("clears failed retry state when a failed-load edit is discarded for the picker", async () => {
    const { aSlice } = accountSwitchSlices();
    let rejectB!: (error: Error) => void;
    let resolveBStarted!: () => void;
    const bStarted = new Promise<void>((resolve) => {
      resolveBStarted = resolve;
    });
    const loadAll = vi
      .fn<(accountId?: string) => Promise<AppData>>()
      .mockResolvedValueOnce(aSlice)
      .mockImplementationOnce(
        () =>
          new Promise<AppData>((_resolve, reject) => {
            resolveBStarted();
            rejectB = reject;
          }),
      );
    const onError = vi.fn();
    const saveAll = vi.fn().mockRejectedValueOnce(new Error("A save failed")).mockResolvedValue(undefined);
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
      ],
    });
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll },
      debounceMs: 0,
      onError,
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    useStore.getState().addClient({ name: "Wayne Enterprises", color: "#222222" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const switchingToB = switchAndAwaitHydration("b1");
    await bStarted;
    useStore.getState().addClient({ name: "Parker Industries", color: "#222222" });
    rejectB(new Error("B unavailable"));
    await expect(switchingToB).resolves.toEqual({ kind: "failed" });

    await expect(switchAndAwaitHydration(null)).resolves.toEqual({ kind: "reloaded" });
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    detach();
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(useStore.getState().activeAccountId).toBeNull();
  });

  it("does not automatically retry a failed account load on focus", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const { aSlice } = accountSwitchSlices();
      const loadAll = vi
        .fn<(accountId?: string) => Promise<AppData>>()
        .mockResolvedValueOnce(aSlice)
        .mockRejectedValueOnce(new Error("B unavailable"));
      useStore.getState().replaceAll(emptyAppData());
      useStore.getState().setActiveAccount(null);
      useStore.getState().setAccountSummaries({
        list: [
          { id: "a1", name: "Alpha", role: "owner" },
          { id: "b1", name: "Beta", role: "owner" },
        ],
      });
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
        debounceMs: 0,
        onError: vi.fn(),
        serverMode: true,
      });

      await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
      await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "failed" });
      now.mockReturnValue(131_000);
      window.dispatchEvent(new Event("focus"));

      detach();
      expect(loadAll).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("does not automatically retry a failed account load after the visible refresh interval", async () => {
    vi.useFakeTimers();
    try {
      const { aSlice } = accountSwitchSlices();
      const loadAll = vi
        .fn<(accountId?: string) => Promise<AppData>>()
        .mockResolvedValueOnce(aSlice)
        .mockRejectedValueOnce(new Error("B unavailable"));
      useStore.getState().replaceAll(emptyAppData());
      useStore.getState().setActiveAccount(null);
      useStore.getState().setAccountSummaries({
        list: [
          { id: "a1", name: "Alpha", role: "owner" },
          { id: "b1", name: "Beta", role: "owner" },
        ],
      });
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
        debounceMs: 0,
        onError: vi.fn(),
        serverMode: true,
      });

      await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
      await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "failed" });
      await vi.advanceTimersByTimeAsync(60_001);

      detach();
      expect(loadAll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an edit parked when the selected account load rejects", async () => {
    vi.useFakeTimers();
    try {
      const { aSlice, bSlice } = accountSwitchSlices();
      let rejectB!: (error: Error) => void;
      const loadAll = vi
        .fn<(accountId?: string) => Promise<AppData>>()
        .mockResolvedValueOnce(aSlice)
        .mockImplementationOnce(
          () =>
            new Promise<AppData>((_resolve, reject) => {
              rejectB = reject;
            }),
        )
        .mockResolvedValueOnce(bSlice);
      const saveAll = vi.fn().mockResolvedValue(undefined);
      useStore.getState().replaceAll(emptyAppData());
      useStore.getState().setActiveAccount(null);
      useStore.getState().setAccountSummaries({
        list: [
          { id: "a1", name: "Alpha", role: "owner" },
          { id: "b1", name: "Beta", role: "owner" },
        ],
      });
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll, saveAll },
        debounceMs: 0,
        onError: vi.fn(),
        serverMode: true,
      });

      await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
      const switching = switchAndAwaitHydration("b1");
      await vi.advanceTimersByTimeAsync(0);
      const edit = requireCreated(useStore.getState().addClient({ name: "Parker Industries", color: "#222222" }));
      rejectB(new Error("B unavailable"));
      await expect(switching).resolves.toEqual({ kind: "failed" });
      await vi.advanceTimersByTimeAsync(31_000);

      expect(useStore.getState().activeAccountLoadFailed).toBe("b1");
      expect(saveAll).not.toHaveBeenCalled();

      await expect(retryActiveAccountLoad("b1")).resolves.toEqual({ kind: "reloaded" });
      await vi.advanceTimersByTimeAsync(0);
      expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["cb", edit.id]);
      expect(saveAll).toHaveBeenCalledTimes(1);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

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
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
      ],
    });
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
    expect(() => requireCreated(useStore.getState().addClient({ name: "Oscorp", color: "#222222" }))).toThrow(
      /not loaded/i,
    );
    expect(saveAll).not.toHaveBeenCalled();

    await expect(retryActiveAccountLoad("b1")).resolves.toEqual({ kind: "reloaded" });
    expect(useStore.getState().activeAccountLoadFailed).toBeNull();
    expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(["cb"]);
    useStore.getState().addClient({ name: "Rand Enterprises", color: "#222222" });
    await expect(flushPendingWrites()).resolves.toEqual({ kind: "clean" });
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
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
      ],
    });
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll },
      debounceMs: 0,
      onError: vi.fn(),
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    useStore.getState().addClient({ name: "Wayne Enterprises", color: "#222222" });
    await vi.waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
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
      accounts: [makeAccount({ id: "c1", name: "Gamma", color: "#1", createdAt: "t", updatedAt: "t" })],
    };
    const loadAll = vi.fn(async (accountId?: string) => {
      if (accountId === "a1") return aSlice;
      if (accountId === "b1") throw new Error("B unavailable");
      return cSlice;
    });
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
        { id: "c1", name: "Gamma", role: "owner" },
      ],
    });
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

  it("discards a failed-load edit before loading a different company", async () => {
    const { aSlice } = accountSwitchSlices();
    const cSlice = {
      ...emptyAppData(),
      accounts: [makeAccount({ id: "c1", name: "Gamma", color: "#1", createdAt: "t", updatedAt: "t" })],
    };
    let rejectB!: (error: Error) => void;
    let resolveBStarted!: () => void;
    const bStarted = new Promise<void>((resolve) => {
      resolveBStarted = resolve;
    });
    let resolveCStarted!: () => void;
    const cStarted = new Promise<void>((resolve) => {
      resolveCStarted = resolve;
    });
    let resolveC!: (data: AppData) => void;
    const loadAll = vi
      .fn<(accountId?: string) => Promise<AppData>>()
      .mockResolvedValueOnce(aSlice)
      .mockImplementationOnce(
        () =>
          new Promise<AppData>((_resolve, reject) => {
            resolveBStarted();
            rejectB = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AppData>((resolve) => {
            resolveCStarted();
            resolveC = resolve;
          }),
      );
    const saveAll = vi.fn().mockResolvedValue(undefined);
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
        { id: "c1", name: "Gamma", role: "owner" },
      ],
    });
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll },
      debounceMs: 0,
      onError: vi.fn(),
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    const switchingToB = switchAndAwaitHydration("b1");
    await bStarted;
    const edit = requireCreated(useStore.getState().addClient({ name: "Parker Industries", color: "#222222" }));
    rejectB(new Error("B unavailable"));
    await expect(switchingToB).resolves.toEqual({ kind: "failed" });

    const switchingToC = switchAndAwaitHydration("c1");
    await cStarted;
    expect(saveAll).not.toHaveBeenCalled();

    resolveC(cSlice);
    await expect(switchingToC).resolves.toEqual({ kind: "reloaded" });
    expect(saveAll).not.toHaveBeenCalled();
    expect(useStore.getState().data.clients).not.toContainEqual(edit);
    expect(useStore.getState().data.accounts[0]?.id).toBe("c1");
    detach();
  });

  // Tenant hydration and sync-baseline reseeding must be atomic without saving the loaded slice.
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
    useStore.getState().setAccountSummaries({ list: [{ id: "a2", name: "Beta", role: "owner" }] });
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
      accounts: [{ ...NULLABLE_FIELDS.accounts, id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
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
    useStore.getState().setAccountSummaries({ list: [{ id: "a2", name: "Beta", role: "owner" }] });
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
      accounts: [makeAccount({ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" })],
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "c2",
          accountId: "a2",
          name: "Stark Industries",
          color: "#1",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    };
    const loadAll = vi.fn(async (accountId?: string) => (accountId === "a2" ? a2Slice : emptyAppData()));
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const adapter: PersistenceAdapter = { loadAll, saveAll };

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({ list: [{ id: "a2", name: "Beta", role: "owner" }] });
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a2")).resolves.toEqual({ kind: "reloaded" });

    // Hydration must not be treated as a user edit or echo the loaded slice back to the server.
    expect(loadAll).toHaveBeenCalledWith("a2");
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["c2"]);

    expect(saveAll).not.toHaveBeenCalled();
    detach();
  });

  it("a genuine edit AFTER a switch still saves (the guard only suppresses the slice load)", async () => {
    vi.useFakeTimers();
    let detach: (() => void) | undefined;
    try {
      const a2Slice = {
        ...emptyAppData(),
        accounts: [makeAccount({ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" })],
      };
      const loadAll = vi.fn(async () => a2Slice);
      const saveAll = vi.fn().mockResolvedValue(undefined);
      const adapter: PersistenceAdapter = { loadAll, saveAll };

      useStore.getState().replaceAll(emptyAppData());
      useStore.getState().setActiveAccount(null);
      useStore.getState().setAccountSummaries({ list: [{ id: "a2", name: "Beta", role: "owner" }] });
      detach = attachPersistence({
        store: useStore,
        adapter: adapter,
        debounceMs: 300,
        serverMode: true,
      });

      await expect(switchAndAwaitHydration("a2")).resolves.toEqual({ kind: "reloaded" });
      expect(saveAll).not.toHaveBeenCalled();

      useStore.getState().addClient({ name: "New Client", color: "#222222" });
      await vi.advanceTimersByTimeAsync(299);
      expect(saveAll).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(flushPendingWrites()).resolves.toEqual({ kind: "clean" });
      expect(saveAll).toHaveBeenCalledTimes(1);
    } finally {
      detach?.();
      vi.useRealTimers();
    }
  });

  it("FLUSHES (does not drop) account A's pending debounced edits before loading B's slice", async () => {
    // Flush account A's pending edit against its own baseline before account B's load
    // reseeds that baseline; otherwise debounce cancellation loses A's edit or crosses tenants.
    const { adapter, wire } = recordingAccountSwitchAdapter();

    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({
      list: [
        { id: "a1", name: "Alpha", role: "owner" },
        { id: "b1", name: "Beta", role: "owner" },
      ],
    });
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 300,
      serverMode: true,
    });

    await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
    expect(useStore.getState().activeAccountId).toBe("a1");

    const edited = requireCreated(useStore.getState().addClient({ name: "A only", color: "#222222" }));
    expect(wire.some((w) => w.ops)).toBe(false);

    await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "reloaded" });

    const carriesA = (o: NonNullable<AccountSwitchWireEntry["ops"]>[number]) =>
      o.row?.accountId === "a1" || o.accountId === "a1";
    const aBatchIdx = wire.findIndex((w) => w.ops?.some((o) => o.id === edited.id && carriesA(o)));
    expect(aBatchIdx).toBeGreaterThanOrEqual(0);

    const bLoadIdx = wire.findIndex((w) => w.url.includes("accountId=b1"));
    expect(bLoadIdx).toBeGreaterThanOrEqual(0);
    expect(aBatchIdx).toBeLessThan(bLoadIdx);

    const afterB = wire.slice(bLoadIdx);
    expect(afterB.some((w) => w.ops?.some(carriesA))).toBe(false);
    expect(useStore.getState().activeAccountId).toBe("b1");
    detach();
  });

  it("rebases an edit landing while a switch load is in flight onto the newly active account", async () => {
    let detach: (() => void) | undefined;
    try {
      const { aSlice, bSlice } = accountSwitchSlices();
      let releaseB: (() => void) | null = null;
      let resolveBStarted!: () => void;
      const bStarted = new Promise<void>((resolve) => {
        resolveBStarted = resolve;
      });
      const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
        if (accountId === "b1") {
          return new Promise<AppData>((resolve) => {
            resolveBStarted();
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
      useStore.getState().setAccountSummaries({
        list: [
          { id: "a1", name: "Alpha", role: "owner" },
          { id: "b1", name: "Beta", role: "owner" },
        ],
      });
      detach = attachPersistence({
        store: useStore,
        adapter: adapter,
        debounceMs: 300,
        onError: onError,
        serverMode: true,
      });

      await expect(switchAndAwaitHydration("a1")).resolves.toEqual({ kind: "reloaded" });
      const switchingToB = switchAndAwaitHydration("b1");
      await bStarted;
      expect(releaseB).not.toBeNull();

      const edit = requireCreated(useStore.getState().addClient({ name: "Mid-switch edit", color: "#222222" }));
      saveAll.mockClear();
      requireCallback(releaseB, "account B load release")();
      await expect(switchingToB).resolves.toEqual({ kind: "reloaded" });

      expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(["cb", edit.id]);
      expect(useStore.getState().data.clients.find((c) => c.id === edit.id)?.accountId).toBe("b1");
      expect(onError).not.toHaveBeenCalled();
      expect(saveAll).toHaveBeenCalledTimes(1);
      const saved = saveAll.mock.calls[0]?.[0] as AppData;
      expect(saved.clients.map((c) => c.id)).toEqual(["cb", edit.id]);
      expect(saved.clients.every((c) => c.accountId === "b1")).toBe(true);
    } finally {
      detach?.();
    }
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
    });

    useStore.getState().setActiveAccount("a2");
    expect(useStore.getState().activeAccountId).toBe("a2");

    expect(loadAll).not.toHaveBeenCalled();
    detach();
  });
});
