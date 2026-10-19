import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";
import { makeAccount, makeAppData, resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import {
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  finishMasqueradeRestorationWrites,
  isMasqueradeOfflineIsolated,
  markMasqueradeOfflineIsolation,
  readCachedAccountSlice,
  readCachedAccountSummaries,
  readCachedAuthSnapshot,
} from "@/data/offlineCache";
import { resetOfflineState } from "@/data/offline/state";
import { MasqueradeController } from "./masqueradeController";
import type { MasqueradeControllerDependencies } from "./masqueradeController";

const state: MasqueradeState = {
  accountId: "a-studio",
  targetUserId: "u-viewer",
  targetName: "Selina Kyle",
  effectiveRole: "viewer",
  startedAt: "2026-09-01T10:00:00.000Z",
  token: "token-1",
};

function realIdentity() {
  return {
    authMode: "password-only" as const,
    user: { id: "bruce-wayne", email: "bruce@example.test", name: "Bruce Wayne" },
    canCreateAccount: false,
    multiAccount: false,
  };
}

function realSlice() {
  return makeAppData({ accounts: [makeAccount({ id: "a-studio", name: "Wayne Enterprises" })] });
}

function dependencies(overrides: Partial<MasqueradeControllerDependencies> = {}): MasqueradeControllerDependencies {
  return {
    flush: async () => ({ kind: "clean" }),
    suspend: () => () => {},
    reproject: async () => true,
    switchAccount: async () => ({ kind: "reloaded" }),
    refreshIdentity: async () => true,
    refreshSummaries: async () => true,
    api: {
      status: async () => ({ active: false }),
      start: async () => state,
      end: async () => {},
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("capacitylens/offlineRead", "on");
  finishMasqueradeRestorationWrites(true);
  resetStoreWithAccount("a-studio");
  useStore.getState().setMasquerade({ kind: "inactive" });
});

afterEach(() => {
  finishMasqueradeRestorationWrites(false);
  resetOfflineState();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("masquerade offline restoration cache boundary", () => {
  it("restores identity scope before writing directory and slice snapshots for immediate offline reload", async () => {
    let projectionCalls = 0;
    const results: unknown[] = [];
    const controller = new MasqueradeController(
      dependencies({
        refreshIdentity: async () => (await cacheAuthSnapshot(realIdentity())).kind === "written",
        reproject: async () => {
          projectionCalls += 1;
          if (projectionCalls === 1) return true;
          const directory = await cacheAccountSummaries([{ id: "a-studio", name: "Wayne Enterprises", role: "owner" }]);
          const slice = await cacheAccountSlice("a-studio", realSlice());
          results.push(directory, slice);
          return directory.kind === "written" && slice.kind === "written";
        },
      }),
    );

    await expect(controller.start(state.accountId, state.targetUserId)).resolves.toBe(true);
    await expect(controller.end()).resolves.toBe(true);

    expect(results).toEqual([{ kind: "written" }, { kind: "written" }]);
    expect(isMasqueradeOfflineIsolated()).toBe(false);
    await expect(readCachedAuthSnapshot()).resolves.toMatchObject({ value: { user: { id: "bruce-wayne" } } });
    await expect(readCachedAccountSummaries()).resolves.toMatchObject({
      value: [{ id: "a-studio", name: "Wayne Enterprises", role: "owner" }],
    });
    await expect(readCachedAccountSlice("a-studio")).resolves.toMatchObject({
      value: { accounts: [{ id: "a-studio", name: "Wayne Enterprises" }] },
    });
  });

  it("selects a company after restoring identity when offline startup has no active company", async () => {
    useStore.getState().setActiveAccount(null);
    markMasqueradeOfflineIsolation();
    const controller = new MasqueradeController(
      dependencies({
        refreshIdentity: async () => (await cacheAuthSnapshot(realIdentity())).kind === "written",
        switchAccount: async (accountId) => {
          useStore.getState().setActiveAccount(accountId);
          const slice = await cacheAccountSlice("a-studio", realSlice());
          return slice.kind === "written" ? { kind: "reloaded" } : { kind: "failed" };
        },
        refreshSummaries: async () =>
          (await cacheAccountSummaries([{ id: "a-studio", name: "Wayne Enterprises", role: "owner" }])).kind ===
          "written",
      }),
    );

    await expect(controller.transitionAccount("a-studio")).resolves.toBe(true);

    expect(useStore.getState().activeAccountId).toBe("a-studio");
    expect(isMasqueradeOfflineIsolated()).toBe(false);
    await expect(readCachedAuthSnapshot()).resolves.toMatchObject({ value: { user: { id: "bruce-wayne" } } });
    await expect(readCachedAccountSummaries()).resolves.toMatchObject({
      value: [{ id: "a-studio", name: "Wayne Enterprises", role: "owner" }],
    });
    await expect(readCachedAccountSlice("a-studio")).resolves.toMatchObject({
      value: { accounts: [{ id: "a-studio", name: "Wayne Enterprises" }] },
    });
  });

  it.each(["projection", "identity", "directory"] as const)(
    "closes restoration cache writes when %s restoration throws",
    async (failure) => {
      const failed = new Error(`${failure} failed`);
      markMasqueradeOfflineIsolation();
      const controller = new MasqueradeController(
        dependencies({
          refreshIdentity:
            failure === "identity"
              ? async () => {
                  throw failed;
                }
              : async () => (await cacheAuthSnapshot(realIdentity())).kind === "written",
          refreshSummaries:
            failure === "directory"
              ? async () => {
                  throw failed;
                }
              : async () => true,
          reproject:
            failure === "projection"
              ? async () => {
                  throw failed;
                }
              : async () => true,
          switchAccount: async (accountId) => {
            useStore.getState().setActiveAccount(accountId);
            return { kind: "reloaded" };
          },
        }),
      );
      if (failure !== "directory") useStore.getState().setMasquerade({ kind: "active", state, generation: 0 });

      if (failure === "directory") {
        await expect(controller.transitionAccount("a-studio")).resolves.toBe(false);
      } else {
        await expect(controller.end()).resolves.toBe(false);
      }

      await expect(cacheAuthSnapshot(realIdentity())).resolves.toEqual({ kind: "skipped", reason: "masquerade" });
      expect(isMasqueradeOfflineIsolated()).toBe(true);
    },
  );
});
