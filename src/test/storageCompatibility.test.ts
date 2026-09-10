import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser storage test harness", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps local and session storage independent while sharing Storage.prototype", () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetItem = vi.spyOn(Storage.prototype, "getItem");

    expect(window.localStorage).toBe(localStorage);
    expect(window.sessionStorage).toBe(sessionStorage);
    expect(window.Storage).toBe(Storage);

    localStorage.setItem("storage-harness-local", "local");
    sessionStorage.setItem("storage-harness-session", "session");

    expect(localStorage.getItem("storage-harness-session")).toBeNull();
    expect(sessionStorage.getItem("storage-harness-local")).toBeNull();
    expect(localStorage.getItem("storage-harness-local")).toBe("local");
    expect(sessionStorage.getItem("storage-harness-session")).toBe("session");
    expect(localSetItem).toHaveBeenCalledTimes(2);
    expect(sessionGetItem).toHaveBeenCalled();
    const storageError = new Error("window storage blocked");
    localSetItem.mockImplementationOnce(() => {
      throw storageError;
    });
    expect(() => window.localStorage.setItem("storage-harness-window", "blocked")).toThrow(storageError);
    expect(localSetItem).toHaveBeenCalledTimes(3);
    expect(Object.getPrototypeOf(localStorage)).toBe(Storage.prototype);
    expect(Object.getPrototypeOf(sessionStorage)).toBe(Storage.prototype);
  });
});
