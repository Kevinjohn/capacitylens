import { afterEach, describe, expect, it, vi } from "vitest";
import { retireBrowserSnapshots } from "./retireBrowserSnapshots";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storageFixture(outcome: "success" | "blocked" = "success") {
  const unrelated = vi.fn();
  const unregister = vi.fn().mockResolvedValue(true);
  const deleteCache = vi.fn().mockResolvedValue(true);
  const deleteDatabase = vi.fn(() => {
    const request = { onsuccess: () => {}, onblocked: () => {} };
    queueMicrotask(() => (outcome === "success" ? request.onsuccess() : request.onblocked()));
    return request;
  });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: vi.fn().mockResolvedValue([
        { active: { scriptURL: "https://example.test/offline-worker.js" }, unregister },
        { waiting: { scriptURL: "https://example.test/other-worker.js" }, unregister: unrelated },
      ]),
    },
  });
  vi.stubGlobal("caches", {
    keys: vi
      .fn()
      .mockResolvedValue(["capacitylens-shell-old", "capacitylens-offline-shell-metadata-v1", "another-app"]),
    delete: deleteCache,
  });
  vi.stubGlobal("indexedDB", { deleteDatabase });
  return { unrelated, unregister, deleteCache, deleteDatabase };
}

describe("retired browser storage", () => {
  it("removes only the former snapshot artifacts and preserves display preferences", async () => {
    const fixture = storageFixture();
    localStorage.setItem("capacitylens/offlineRead", "on");
    localStorage.setItem("capacitylens/theme", "dark");
    await retireBrowserSnapshots();
    expect(localStorage.getItem("capacitylens/offlineRead")).toBeNull();
    expect(localStorage.getItem("capacitylens/theme")).toBe("dark");
    expect(fixture.deleteDatabase).toHaveBeenCalledWith("capacitylens-offline-v1");
    expect(fixture.unregister).toHaveBeenCalledOnce();
    expect(fixture.unrelated).not.toHaveBeenCalled();
    expect(fixture.deleteCache.mock.calls).toEqual([
      ["capacitylens-shell-old"],
      ["capacitylens-offline-shell-metadata-v1"],
    ]);
  });

  it("reports blocked deletion after still removing the obsolete worker and shell", async () => {
    const fixture = storageFixture("blocked");
    await expect(retireBrowserSnapshots()).rejects.toThrow("Retired browser storage could not be fully removed");
    expect(fixture.unregister).toHaveBeenCalledOnce();
    expect(fixture.deleteCache).toHaveBeenCalledTimes(2);
  });
});
