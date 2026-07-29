import { describe, expect, it } from "vitest";
import { nextServerRevision } from "./revision";

describe("nextServerRevision", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");

  it("advances a canonical future revision by one millisecond", () => {
    expect(nextServerRevision("2027-01-01T00:00:00.000Z", now)).toBe("2027-01-01T00:00:00.001Z");
  });

  it.each([
    ["2027-01-01T01:00:00+01:00", "2027-01-01T00:00:00.001Z"],
    ["2027-01-01T00:00:00Z", "2027-01-01T00:00:00.001Z"],
  ])("chronologically advances a supported non-canonical ISO revision: %s", (stored, expected) => {
    expect(nextServerRevision(stored, now)).toBe(expected);
  });

  it.each(["9999-12-31T23:59:59.999Z", "+010000-01-01T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"])(
    "repairs an unincrementable or out-of-domain revision: %s",
    (stored) => {
      expect(nextServerRevision(stored, now)).toBe("2026-07-29T12:00:00.000Z");
    },
  );

  it("repairs malformed metadata without throwing", () => {
    expect(nextServerRevision("not-a-timestamp", now)).toBe("2026-07-29T12:00:00.000Z");
  });

  it.each(["2026-02-30T12:00:00.000Z", "2026-04-31T00:00:00.000Z"])(
    "repairs a calendar-normalized timestamp instead of advancing its rollover: %s",
    (stored) => {
      expect(nextServerRevision(stored, now)).toBe("2026-07-29T12:00:00.000Z");
    },
  );
});
