import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATE_STYLES, DEFAULT_DATE_STYLE, readActiveDateStyle, writeStoredDateStyle } from "./dateStyle";

/** Simulate a browser that refuses the write: private mode, blocked site data, full quota. */
function refuseWrites() {
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  // A write that storage refused leaves this session's choice in the module; a successful write
  // clears it, so later specs start from the default again.
  writeStoredDateStyle(DEFAULT_DATE_STYLE);
  localStorage.clear();
});

describe("DATE_STYLES / DEFAULT_DATE_STYLE", () => {
  it("lists all four styles in the documented order", () => {
    expect(DATE_STYLES).toEqual(["day-month", "day-ordinal-month", "month-day", "month-day-ordinal"]);
  });

  it("defaults to day-month", () => {
    expect(DEFAULT_DATE_STYLE).toBe("day-month");
  });
});

describe("readActiveDateStyle", () => {
  it("defaults to day-month when nothing is stored", () => {
    expect(readActiveDateStyle()).toBe(DEFAULT_DATE_STYLE);
  });

  it("round-trips a written preference", () => {
    writeStoredDateStyle("month-day");
    expect(readActiveDateStyle()).toBe("month-day");
    writeStoredDateStyle("day-ordinal-month");
    expect(readActiveDateStyle()).toBe("day-ordinal-month");
    writeStoredDateStyle("month-day-ordinal");
    expect(readActiveDateStyle()).toBe("month-day-ordinal");
  });

  it("reads storage fresh on every call rather than caching", () => {
    expect(readActiveDateStyle()).toBe("day-month");
    localStorage.setItem("capacitylens/dateStyle", "month-day");
    expect(readActiveDateStyle()).toBe("month-day");
  });

  it("falls back to the default when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readActiveDateStyle()).toBe(DEFAULT_DATE_STYLE);
  });

  it("falls back to the default for an unrecognised stored value", () => {
    localStorage.setItem("capacitylens/dateStyle", "neon");
    expect(readActiveDateStyle()).toBe(DEFAULT_DATE_STYLE);
  });

  it("falls back to the default when an empty string is stored", () => {
    // Distinguishes the real equality checks from a mutant that compares against "" instead — an
    // empty string is not a valid style id.
    localStorage.setItem("capacitylens/dateStyle", "");
    expect(readActiveDateStyle()).toBe(DEFAULT_DATE_STYLE);
  });

  it("keeps a choice storage refused for the rest of the session", () => {
    // Otherwise the Settings control would move while every formatter kept reading the default.
    refuseWrites();
    writeStoredDateStyle("month-day");

    expect(localStorage.getItem("capacitylens/dateStyle")).toBeNull();
    expect(readActiveDateStyle()).toBe("month-day");
  });

  it("prefers a refused choice over an older stored one", () => {
    // The stored value is readable here — only the write is refused, as on a full quota — so
    // resolving storage first would answer with the style the user has just replaced.
    writeStoredDateStyle("month-day");
    refuseWrites();
    writeStoredDateStyle("day-ordinal-month");

    expect(localStorage.getItem("capacitylens/dateStyle")).toBe("month-day");
    expect(readActiveDateStyle()).toBe("day-ordinal-month");
  });

  it("drops the session choice once a write succeeds", () => {
    const setItem = refuseWrites();
    writeStoredDateStyle("month-day");
    setItem.mockRestore();

    writeStoredDateStyle("day-ordinal-month");
    localStorage.clear();
    expect(readActiveDateStyle()).toBe(DEFAULT_DATE_STYLE);
  });

  it("persists under the documented storage key", () => {
    writeStoredDateStyle("month-day");
    expect(localStorage.getItem("capacitylens/dateStyle")).toBe("month-day");
  });
});
