import { describe, expect, it } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { sanitizeWrite, validateWrite } from "./validate";

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "to1",
  accountId: "a1",
  resourceId: null,
  startDate: "2026-12-24",
  endDate: "2026-12-25",
  type: "holiday",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("company-wide time-off validation", () => {
  it("accepts explicit null without looking up a resource", () => {
    const sanitized = sanitizeWrite("timeOff", row());
    expect(sanitized.resourceId).toBeNull();
    expect(() => validateWrite(emptyAppData(), "timeOff", sanitized)).not.toThrow();
  });

  it("rejects an omitted resourceId", () => {
    const missing = row();
    delete missing.resourceId;
    expect(() => sanitizeWrite("timeOff", missing)).toThrow(/missing required field.*resourceId/i);
  });

  it("repairs unsupported Everyone types and still rejects reversed dates", () => {
    expect(sanitizeWrite("timeOff", row({ type: "sick" })).type).toBe("other");
    expect(sanitizeWrite("timeOff", row({ type: "unpaid" })).type).toBe("other");
    expect(() => validateWrite(emptyAppData(), "timeOff", row({ endDate: "2026-12-23" }))).toThrow(
      /end date cannot be before the start date/i,
    );
  });
});
