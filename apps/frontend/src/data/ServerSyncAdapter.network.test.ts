import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";

// Old device preferences must never turn a failed server read into browser persistence access.
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server read failures", () => {
  it.each([undefined, "a-studio"])(
    "surfaces a network failure without opening browser storage (%s)",
    async (accountId) => {
      localStorage.setItem("capacitylens/offlineRead", "on");
      const open = vi.fn(() => {
        throw new Error("Browser databases are unavailable");
      });
      vi.stubGlobal("indexedDB", { open });
      const cause = new TypeError("Network unavailable");
      const adapter = new ServerSyncAdapter("http://api.test", vi.fn().mockRejectedValue(cause));

      await expect(adapter.loadAll(accountId)).rejects.toMatchObject({
        name: "LoadError",
        kind: "unavailable",
        cause,
      });
      expect(open).not.toHaveBeenCalled();
    },
  );
});
