import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { accountClient } from "@/account/accountClient";
import { cacheAuthSnapshot, markMasqueradeOfflineIsolation, readCachedAuthSnapshot } from "@/data/offlineCache";
import { fetchAuthStatus } from "./fetchAuthStatus";
import { masqueradeApi } from "./masqueradeApi";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("capacitylens/offlineRead", "on");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline auth with uncertain masquerade status", () => {
  it("refuses the cached identity and prevents projected snapshot writes", async () => {
    const identity = {
      authMode: "password-only" as const,
      user: { id: "offline-user", email: "offline@example.test", name: "Offline user" },
      canCreateAccount: false,
      multiAccount: false,
    };
    await expect(cacheAuthSnapshot(identity)).resolves.toEqual({ kind: "written" });
    markMasqueradeOfflineIsolation();

    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
    await expect(cacheAuthSnapshot({ ...identity, user: { ...identity.user, id: "projected-user" } })).resolves.toEqual(
      { kind: "skipped", reason: "masquerade" },
    );

    const status = vi.spyOn(masqueradeApi, "status").mockRejectedValue(new TypeError("offline"));
    const me = vi.spyOn(accountClient, "me").mockRejectedValue(new TypeError("offline"));
    try {
      expect(await fetchAuthStatus(() => true)).toMatchObject({ kind: "error" });
      expect(status).toHaveBeenCalledOnce();
      expect(me).toHaveBeenCalledOnce();
    } finally {
      status.mockRestore();
      me.mockRestore();
    }
  });
});
