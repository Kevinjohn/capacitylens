import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { attachPersistence, switchAndAwaitHydration } from "./persist";

beforeEach(() => resetStoreWithAccount());

describe("account-switch attempt settlement", () => {
  it("settles a superseded pick even when its load never returns", async () => {
    const loadAll = vi.fn(async (id?: string) =>
      id === "a1"
        ? new Promise<AppData>(() => undefined)
        : {
            ...emptyAppData(),
            accounts: [{ id: "b1", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
          },
    );
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll: vi.fn(async () => {}) },
      serverMode: true,
    });
    const first = switchAndAwaitHydration("a1");
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalledWith("a1"));
    const picker = switchAndAwaitHydration(null);
    await expect(first).resolves.toEqual({ kind: "skipped" });
    await expect(picker).resolves.toEqual({ kind: "reloaded" });
    await expect(switchAndAwaitHydration("b1")).resolves.toEqual({ kind: "reloaded" });
    detach();
  });

  it("does not settle a newer same-account pick from an older load", async () => {
    const loads: Array<(data: AppData) => void> = [];
    const loadAll = vi.fn(
      async () =>
        new Promise<AppData>((resolve) => {
          loads.push(resolve);
        }),
    );
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "b1", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll: vi.fn(async () => {}) },
      serverMode: true,
    });
    const firstA = switchAndAwaitHydration("a1");
    await vi.waitFor(() => expect(loads).toHaveLength(1));
    const toB = switchAndAwaitHydration("b1");
    await vi.waitFor(() => expect(loads).toHaveLength(2));
    const lastA = switchAndAwaitHydration("a1");
    await expect(firstA).resolves.toEqual({ kind: "skipped" });
    await expect(toB).resolves.toEqual({ kind: "skipped" });
    await vi.waitFor(() => expect(loads).toHaveLength(3));
    let lastSettled = false;
    void lastA.then(() => {
      lastSettled = true;
    });
    const finishLoad = (index: number, data: AppData) => {
      const resolve = loads[index];
      if (!resolve) throw new Error(`Expected load ${index}`);
      resolve(data);
    };
    finishLoad(0, emptyAppData());
    await Promise.resolve();
    expect(lastSettled).toBe(false);
    finishLoad(1, emptyAppData());
    await Promise.resolve();
    expect(lastSettled).toBe(false);
    finishLoad(2, {
      ...emptyAppData(),
      accounts: [{ id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" }],
    });
    await expect(lastA).resolves.toEqual({ kind: "reloaded" });
    detach();
  });
});
