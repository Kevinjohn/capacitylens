import { describe, it, expect, vi, afterEach } from "vitest";
import { todayISO } from "./today";
import { toISODate } from "./dateMath";

describe("todayISO", () => {
  it("returns the local date when no timeZone given", () => {
    const result = todayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a YYYY-MM-DD string for a valid time zone", () => {
    const result = todayISO("America/New_York");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the correct date for zones on both sides of midnight", () => {
    expect(() => todayISO("Pacific/Auckland")).not.toThrow();
    expect(() => todayISO("America/Los_Angeles")).not.toThrow();
    expect(() => todayISO("Etc/GMT")).not.toThrow();
  });

  it("falls back gracefully when given undefined", () => {
    expect(() => todayISO(undefined)).not.toThrow();
    expect(todayISO(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("todayISO with a fixed clock", () => {
  describe("with a fixed clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves the date in the GIVEN zone, not the local one — even when they disagree", () => {
      // The UTC instant is still June 14, while Kiritimati is already on June 15.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T20:00:00Z"));
      expect(todayISO("Pacific/Kiritimati")).toBe("2026-06-15");
    });

    it("resolves an EXPLICIT instant rather than the clock when `now` is given", () => {
      // The reactive-today boundary search probes future instants through this one resolver;
      // ignoring `now` would make every probe answer with the current date and the search
      // would never find the boundary.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T20:00:00Z"));
      const tomorrowUTC = Date.parse("2026-06-15T20:00:00Z");
      expect(todayISO("UTC", Date.parse("2026-06-14T20:00:00Z"))).toBe("2026-06-14");
      expect(todayISO("UTC", tomorrowUTC)).toBe("2026-06-15");
      expect(todayISO(undefined, tomorrowUTC)).toBe(toISODate(new Date(tomorrowUTC)));
    });

    it("always resolves the SAME zone, ignoring which timeZone happens to be passed", () => {
      // Guards the early-return short-circuit `if (!timeZone) return toISODate(new
      // Date())`: forcing it to always fire (dropping the timeZone argument on the
      // floor) would make a valid, given zone come back as the local date instead.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T20:00:00Z"));
      expect(todayISO("Pacific/Kiritimati")).not.toBe(todayISO());
    });
  });
});

describe("todayISO with mocked out-of-range years", () => {
  describe("with a mocked Intl.DateTimeFormat", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // `todayISO` caches one formatter per zone at module scope, so each case here takes a fresh
    // module instance (the same isolation the aggregate-warning case below uses), otherwise the
    // real formatter an earlier test cached for the same zone would answer instead of the mock.
    async function isolatedToday() {
      vi.resetModules();
      return await import("./today");
    }

    it("throws RangeError (not a silent pseudo-ISODate) when the resolved year is outside the four-digit domain", async () => {
      // Mock malformed formatter output to verify that an out-of-domain year is rejected.
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: "year", value: "99" },
            { type: "literal", value: "-" },
            { type: "month", value: "06" },
            { type: "literal", value: "-" },
            { type: "day", value: "15" },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedToday();
      expect(() => isolated.todayISO("Pacific/Kiritimati")).toThrow(/four-digit ISO year range/i);
    });

    it("does NOT swallow the out-of-range-year error as an 'invalid timeZone' fallback", async () => {
      // The catch block around the Intl constructor call must not also catch (and silently
      // degrade) a RangeError raised by the post-assembly validation. That would misreport a
      // real bug as a benign invalid-zone case and return the (wrong) local date instead of
      // throwing per the module's contract.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: "year", value: "10000" },
            { type: "literal", value: "-" },
            { type: "month", value: "01" },
            { type: "literal", value: "-" },
            { type: "day", value: "01" },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedToday();
      expect(() => isolated.todayISO("America/New_York")).toThrow(RangeError);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

describe("todayISO formatter caching", () => {
  describe("with a mocked Intl.DateTimeFormat", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function isolatedToday() {
      vi.resetModules();
      return await import("./today");
    }
    it("still returns a valid zero-padded ISODate on the normal timezone path", async () => {
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: "year", value: "2026" },
            { type: "literal", value: "-" },
            { type: "month", value: "06" },
            { type: "literal", value: "-" },
            { type: "day", value: "05" },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedToday();
      expect(isolated.todayISO("America/New_York")).toBe("2026-06-05");
    });

    it("builds one formatter per zone and reuses it across calls", async () => {
      // Constructing a formatter is the expensive part and todayISO runs per grid render, so the
      // per-zone cache is load-bearing, not incidental.
      const ctorSpy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: "year", value: "2026" },
            { type: "literal", value: "-" },
            { type: "month", value: "06" },
            { type: "literal", value: "-" },
            { type: "day", value: "05" },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);
      const isolated = await isolatedToday();

      isolated.todayISO("America/New_York");
      isolated.todayISO("America/New_York", Date.parse("2026-06-15T20:00:00Z"));
      isolated.todayISO("Pacific/Kiritimati");

      const zones = ctorSpy.mock.calls.map(
        ([, options]) => (options as Intl.DateTimeFormatOptions | undefined)?.timeZone,
      );
      expect(zones).toEqual(["America/New_York", "Pacific/Kiritimati"]);
    });
  });
});

describe("todayISO invalid zones", () => {
  it("warns (not silently) and still returns a valid local date for a malformed IANA zone", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => todayISO("Not/AZone")).not.toThrow();
    const result = todayISO("Not/AZone");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe(toISODate(new Date()));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('todayISO: invalid timeZone "Not/AZone"'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("emits one aggregate warning when invalid-zone deduplication reaches its bound", async () => {
    vi.resetModules();
    const isolated = await import("./today");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let index = 0; index < 33; index += 1) {
      expect(isolated.todayISO(`Invalid/Zone-${index}`)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    expect(warnSpy).toHaveBeenCalledTimes(33);
    expect(warnSpy.mock.calls.at(-1)?.[0]).toMatch(/32 distinct invalid time zones.*further distinct values/i);
    isolated.todayISO("Invalid/Zone-34");
    expect(warnSpy).toHaveBeenCalledTimes(33);
    warnSpy.mockRestore();
  });
});
