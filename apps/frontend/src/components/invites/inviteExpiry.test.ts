import { describe, expect, it } from "vitest";
import { formatInviteExpiry, formatInviteExpiryDate } from "./inviteExpiry";

describe("invite expiry formatters", () => {
  it.each(["2026-09-10T14:05:37.000Z", "2027-01-02T09:07:59.000Z"])(
    "formats the invitation date on the viewer's local calendar for %s",
    (expiresAt) => {
      expect(formatInviteExpiryDate(expiresAt)).toBe(new Date(expiresAt).toLocaleDateString());
      expect(formatInviteExpiryDate(expiresAt)).not.toContain(":");
    },
  );

  it("preserves distinct invalid-input contracts for date-time and date-only invite expiry", () => {
    expect(() => formatInviteExpiry("not-a-timestamp")).toThrow(RangeError);
    expect(formatInviteExpiryDate("not-a-timestamp")).toBe("Invalid Date");
  });
});
