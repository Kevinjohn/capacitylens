import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { PersistenceAdapter } from "./PersistenceAdapter";
import { BatchConflictError } from "./ServerSyncAdapter";
import {
  attachPersistence,
  flushPendingWrites,
  hasUnsavedPersistenceWrites,
  refreshActiveAccountSlice,
  switchAndAwaitHydration,
} from "./persist";
import { useStore } from "../store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeAppData, resetStoreWithAccount } from "../test/fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const secondAccount = makeAccount({ id: "a-loft", name: "Stark Industries" });
let detach: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  resetStoreWithAccount();
  useStore.getState().setAccountSummaries([
    { id: DEFAULT_ACCOUNT_ID, name: "Wayne Enterprises", role: "owner" },
    { id: secondAccount.id, name: secondAccount.name, role: "owner" },
  ]);
});
afterEach(() => {
  detach?.();
  detach = undefined;
});

describe("persistence save/reload/switch overlap", () => {
  it("lets the newest switch await a save and retain an edit parked during its load", async () => {
    const saving = deferred<void>();
    const loading = deferred<AppData>();
    const loadAll = vi.fn(async () => loading.promise);
    const saveAll = vi.fn<PersistenceAdapter["saveAll"]>().mockResolvedValue(undefined);
    saveAll.mockImplementationOnce(() => saving.promise);
    detach = attachPersistence(useStore, { loadAll, saveAll }, 0, undefined, undefined, true);
    useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" });

    const refreshing = refreshActiveAccountSlice(DEFAULT_ACCOUNT_ID);
    const switching = switchAndAwaitHydration(secondAccount.id);
    expect(loadAll).not.toHaveBeenCalled();
    expect(hasUnsavedPersistenceWrites()).toBe(true);

    saving.resolve();
    await expect(refreshing).resolves.toBe("skipped");
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalledExactlyOnceWith(secondAccount.id));
    const parked = useStore.getState().addClient({ name: "Stark Industries", color: "#222222" });
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(await flushPendingWrites()).toBe(false);

    loading.resolve(makeAppData({ accounts: [secondAccount] }));
    await expect(switching).resolves.toBe("reloaded");
    expect(await flushPendingWrites()).toBe(true);
    expect(useStore.getState().activeAccountId).toBe(secondAccount.id);
    expect(useStore.getState().data.clients).toContainEqual(parked);
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect(saveAll.mock.calls[1]![0].clients).toContainEqual(parked);
    expect(hasUnsavedPersistenceWrites()).toBe(false);
  });

  it("keeps a completed switch authoritative when the old reconciliation load later fails", async () => {
    const oldLoad = deferred<AppData>();
    const newLoad = deferred<AppData>();
    const conflict = new BatchConflictError("conflict");
    const onError = vi.fn();
    const loadAll = vi
      .fn<PersistenceAdapter["loadAll"]>()
      .mockImplementationOnce(() => oldLoad.promise)
      .mockImplementationOnce(() => newLoad.promise);
    const saveAll = vi.fn<PersistenceAdapter["saveAll"]>().mockResolvedValue(undefined);
    saveAll.mockRejectedValueOnce(conflict);
    detach = attachPersistence(useStore, { loadAll, saveAll }, 0, onError, undefined, true);
    useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" });
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalledExactlyOnceWith(DEFAULT_ACCOUNT_ID));

    const switching = switchAndAwaitHydration(secondAccount.id);
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalledTimes(2));
    const authoritative = makeAppData({ accounts: [secondAccount] });
    newLoad.resolve(authoritative);
    await expect(switching).resolves.toBe("reloaded");
    oldLoad.reject(new Error("old account unavailable"));
    await vi.waitFor(() => expect(flushPendingWrites()).resolves.toBe(true));

    expect(onError).toHaveBeenCalledExactlyOnceWith(conflict);
    expect(useStore.getState().data.accounts).toEqual(authoritative.accounts);
    const client = useStore.getState().addClient({ name: "Stark Industries", color: "#222222" });
    expect(await flushPendingWrites()).toBe(true);
    expect(saveAll.mock.lastCall![0].clients).toContainEqual(client);
    expect(hasUnsavedPersistenceWrites()).toBe(false);
  });
});
