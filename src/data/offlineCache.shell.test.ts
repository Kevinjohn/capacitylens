import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory } from "fake-indexeddb";

import { isOfflineShellAvailable } from "./offlineCache";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("offline shell availability", () => {
  it("allows production and test builds but rejects on-demand development module graphs", () => {
    expect(isOfflineShellAvailable({ PROD: true, MODE: "production" })).toBe(true);
    expect(isOfflineShellAvailable({ PROD: false, MODE: "test" })).toBe(true);
    expect(isOfflineShellAvailable({ PROD: false, MODE: "development" })).toBe(false);
  });
});
