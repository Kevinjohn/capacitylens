import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { makeAccount } from "../../test/fixtures";
import { readOfflineStateSnapshot, resetOfflineState, scope, setOfflineReadState } from "../offline/state";
import { cacheAuthSnapshot, cacheAccountSlice, setOfflineReadEnabled } from "../offlineCache";
import { hydrateFromOfflineCache, loadAll } from "./loadSlice";
import { SyncState } from "./SyncState";

afterEach(() => {
  resetOfflineState();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadAll repair write", () => {
  it("leaves a newer load's offline read-only state alone when an older repair finishes", async () => {
    const account = makeAccount({ id: "a-older" });
    // No Internal client, so the load must write a repair before it goes online.
    const payload = { ...emptyAppData(), accounts: [account] };
    const state = new SyncState("http://api.test", async () => Response.json(payload));
    let releaseRepair: () => void = () => {};
    const repairWritten = new Promise<void>((resolve) => {
      releaseRepair = resolve;
    });
    let repairStarted: () => void = () => {};
    const repairRequested = new Promise<void>((resolve) => {
      repairStarted = resolve;
    });

    const olderLoad = loadAll(
      state,
      () => {
        repairStarted();
        return repairWritten;
      },
      { accountId: account.id },
    );
    await repairRequested;

    // A newer load starts and falls back to a cached slice, which is read-only.
    state.loadGen += 1;
    setOfflineReadState("tenant", true, 123);

    releaseRepair();
    await olderLoad;
    expect(readOfflineStateSnapshot().readOnly).toBe(true);
  });
});

describe("pending offline fallback", () => {
  it.each([undefined, "a-studio"])("rejects a pending cache read after opt-out (account: %s)", async (accountId) => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.setItem("capacitylens/offlineRead", "on");
    await cacheAuthSnapshot({
      authMode: "password-only",
      user: { id: "user-a", email: "user-a@example.test", name: "Bruce Wayne" },
      canCreateAccount: false,
      multiAccount: false,
    });
    const data = { ...emptyAppData(), accounts: [makeAccount({ id: "a-studio" })] };
    await cacheAccountSlice("a-studio", data);
    let markReadStarted: () => void = () => {};
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    let releaseRead: () => void = () => {};
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...parameters) => {
      const plaintext = await decrypt(...parameters);
      markReadStarted();
      await readReleased;
      return plaintext;
    });
    const state = new SyncState("http://api.test", vi.fn());
    const originalSnapshot = state.lastSynced;

    const fallback = hydrateFromOfflineCache(state, accountId, state.loadGen);
    await readStarted;
    await setOfflineReadEnabled(false);
    releaseRead();

    await expect(fallback).resolves.toBeNull();
    expect(state.lastSynced).toBe(originalSnapshot);
    expect(state.seedGen).toBe(0);
    expect(readOfflineStateSnapshot().readOnly).toBe(false);
    expect(scope).toBeNull();
  });
});
