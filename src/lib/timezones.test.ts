import { describe, it, expect, afterEach, vi } from "vitest";
import { supportedTimeZones, timeZoneOffsetLabel, timeZoneOptionLabel } from "./timezones";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("supportedTimeZones", () => {
  it("prepends Etc/GMT when the engine list omits it", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["UTC", "Europe/London"]);
    expect(supportedTimeZones()).toEqual(["Etc/GMT", "UTC", "Europe/London"]);
  });

  it("does not duplicate Etc/GMT when the engine list already has it", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Etc/GMT", "UTC"]);
    expect(supportedTimeZones()).toEqual(["Etc/GMT", "UTC"]);
  });

  it("falls back to the documented hand-list when the engine lacks the API", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => {
      throw new Error("Intl.supportedValuesOf is not supported");
    });
    expect(supportedTimeZones()).toEqual([
      "Etc/GMT",
      "UTC",
      "Europe/London",
      "Europe/Paris",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Australia/Sydney",
    ]);
  });
});

describe("time zone option labels", () => {
  it("shows a numeric UTC offset for a zero-offset zone", () => {
    expect(timeZoneOffsetLabel("Etc/GMT", new Date("2026-07-01T12:00:00.000Z"))).toBe("UTC+00:00");
    expect(timeZoneOptionLabel("Etc/GMT", "GMT", new Date("2026-07-01T12:00:00.000Z"))).toBe("GMT (UTC+00:00)");
  });

  it("reflects daylight-saving offsets for named zones", () => {
    const summer = new Date("2026-07-01T12:00:00.000Z");
    const winter = new Date("2026-01-01T12:00:00.000Z");
    expect(timeZoneOffsetLabel("Europe/London", summer)).toBe("UTC+01:00");
    expect(timeZoneOffsetLabel("Europe/London", winter)).toBe("UTC+00:00");
    expect(timeZoneOptionLabel("America/New_York", "America/New_York", summer)).toBe("America/New_York (UTC-04:00)");
  });

  it("does not cache across a half-hour DST transition inside one UTC hour", () => {
    expect(timeZoneOffsetLabel("Australia/Lord_Howe", new Date("2026-10-03T15:15:00.000Z"))).toBe("UTC+10:30");
    expect(timeZoneOffsetLabel("Australia/Lord_Howe", new Date("2026-10-03T15:45:00.000Z"))).toBe("UTC+11:00");
  });

  it("preserves an engine-specific offset suffix while normalizing its GMT prefix", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "timeZoneName", value: "GMT+5:30:45" },
    ]);

    expect(timeZoneOffsetLabel("Asia/Kathmandu", new Date("2026-07-01T12:02:00.000Z"))).toBe("UTC+5:30:45");
  });

  it("falls back to zero offset for an invalid persisted zone", () => {
    expect(timeZoneOffsetLabel("Not/A_Zone", new Date("2026-07-01T12:03:00.000Z"))).toBe("UTC+00:00");
  });
});

describe("timeZoneOffsetLabel caching", () => {
  it("builds one Intl.DateTimeFormat per zone and reuses it across UTC minutes", () => {
    const ctorSpy = vi.spyOn(Intl, "DateTimeFormat");
    const zone = "Pacific/Auckland";
    timeZoneOffsetLabel(zone, new Date("2026-07-01T12:07:00.000Z"));
    timeZoneOffsetLabel(zone, new Date("2026-07-01T13:07:00.000Z"));
    const zoneConstructions = ctorSpy.mock.calls.filter(
      ([, options]) => (options as Intl.DateTimeFormatOptions | undefined)?.timeZone === zone,
    );
    expect(zoneConstructions).toHaveLength(1);
  });

  it("caches the label within the same UTC minute even as the exact date instant differs", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const zone = "Asia/Tbilisi";
    timeZoneOffsetLabel(zone, new Date("2026-07-01T12:08:05.000Z"));
    timeZoneOffsetLabel(zone, new Date("2026-07-01T12:08:45.000Z"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("still resolves to zero offset — without a stale cache read — if the timeZoneName part is ever missing", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([]);
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const zone = "Asia/Novosibirsk";
    const date = new Date("2026-07-01T12:09:00.000Z");
    expect(timeZoneOffsetLabel(zone, date)).toBe("UTC+00:00");
    expect(timeZoneOffsetLabel(zone, date)).toBe("UTC+00:00");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("timeZoneOffsetLabel offset-string parsing", () => {
  const mockOffsetValue = (value: string) => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "timeZoneName", value } as Intl.DateTimeFormatPart,
    ]);
  };

  it.each([
    ["Europe/Paris", "GMT+5", "UTC+05:00"],
    ["Europe/Berlin", "GMT+12", "UTC+12:00"],
    ["Asia/Kolkata", "GMT+5:30", "UTC+05:30"],
    ["Pacific/Fiji", "GMT+0530", "UTC+05:30"],
    ["America/Chicago", "GMT-8", "UTC-08:00"],
    ["Europe/Madrid", "UTC+2", "UTC+02:00"],
  ])("parses a mocked %s offset of %s into %s", (zone, mocked, expected) => {
    mockOffsetValue(mocked);
    expect(timeZoneOffsetLabel(zone, new Date("2026-07-01T12:00:00.000Z"))).toBe(expected);
  });

  it.each([
    ["Europe/Vienna", "GMT"],
    ["America/Denver", "UTC"],
  ])("treats a bare %s value (%s) as zero offset, not a literal GMT/UTC suffix", (zone, mocked) => {
    mockOffsetValue(mocked);
    expect(timeZoneOffsetLabel(zone, new Date("2026-07-01T12:00:00.000Z"))).toBe("UTC+00:00");
  });

  it("swaps only a leading GMT prefix to UTC when the value does not match a sign+offset shape", () => {
    mockOffsetValue("GMTx");
    expect(timeZoneOffsetLabel("Asia/Dubai", new Date("2026-07-01T12:00:00.000Z"))).toBe("UTCx");
  });

  it("leaves a non-leading GMT untouched — the prefix swap is anchored to the string start", () => {
    mockOffsetValue("XGMT");
    expect(timeZoneOffsetLabel("Europe/Rome", new Date("2026-07-01T12:00:00.000Z"))).toBe("XGMT");
  });

  it("refuses to parse an offset out of a value that only ENDS in a GMT offset — the sign+offset match is anchored too", () => {
    // "XGMT+5" must fall through to the non-matching branch (and keep its non-leading GMT verbatim),
    // not be read as GMT+5 by an unanchored match against the embedded suffix.
    mockOffsetValue("XGMT+5");
    expect(timeZoneOffsetLabel("America/Lima", new Date("2026-07-01T12:00:00.000Z"))).toBe("XGMT+5");
  });
});
