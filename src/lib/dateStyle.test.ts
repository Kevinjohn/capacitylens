import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATE_STYLES, DEFAULT_DATE_STYLE, readActiveDateStyle, writeStoredDateStyle } from "./dateStyle";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
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

  it("persists under the documented storage key", () => {
    writeStoredDateStyle("month-day");
    expect(localStorage.getItem("capacitylens/dateStyle")).toBe("month-day");
  });
});
