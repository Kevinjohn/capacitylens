import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearCapacitylensLocalStorage,
  CAPACITYLENS_KEY_PREFIX,
  readCapacitylensLocalStorage,
} from "./clearLocalStorage";

describe("clearCapacitylensLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("removes every app key and leaves unrelated origin keys alone", () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    localStorage.setItem("capacitylens/theme", "dark");
    localStorage.setItem("capacitylens/sidebar", "true");
    localStorage.setItem("some-other-tool", "keep");
    localStorage.setItem("analytics", "keep");

    const removed = clearCapacitylensLocalStorage();

    expect(removed).toBe(3);
    expect(localStorage.getItem("capacitylens/offlineRead")).toBeNull();
    expect(localStorage.getItem("capacitylens/theme")).toBeNull();
    expect(localStorage.getItem("capacitylens/sidebar")).toBeNull();
    expect(localStorage.getItem("some-other-tool")).toBe("keep");
    expect(localStorage.getItem("analytics")).toBe("keep");
  });

  it("is a no-op (returns 0) when no capacitylens keys exist", () => {
    localStorage.setItem("unrelated", "x");
    expect(clearCapacitylensLocalStorage()).toBe(0);
    expect(localStorage.getItem("unrelated")).toBe("x");
  });

  it("reads owned raw values without including sibling-origin data", () => {
    localStorage.setItem("capacitylens/data", "{not-json");
    localStorage.setItem("unrelated", "keep-private");

    expect(readCapacitylensLocalStorage()).toEqual([{ key: "capacitylens/data", value: "{not-json" }]);
  });

  it("removes ALL matching keys even though removal mutates the key list mid-clear", () => {
    // Snapshotting the keys first is what makes this safe — iterating by live index would
    // skip entries as the list re-indexes on each removeItem.
    for (let i = 0; i < 10; i++) localStorage.setItem(`${CAPACITYLENS_KEY_PREFIX}k${i}`, String(i));
    expect(clearCapacitylensLocalStorage()).toBe(10);
    expect(localStorage.length).toBe(0);
  });

  it("does not swallow a storage failure — it propagates to the caller", () => {
    const store = {
      length: 1,
      key: () => "capacitylens/theme",
      removeItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
      getItem: () => null,
      setItem: () => {},
      clear: () => {},
    } as unknown as Storage;
    expect(() => clearCapacitylensLocalStorage(store)).toThrow("storage disabled");
  });
});
