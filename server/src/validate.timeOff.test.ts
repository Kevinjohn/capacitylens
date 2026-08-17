import { describe, expect, it } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { sanitizeWrite, validateWrite } from "./validate";

const meta = {
  id: "row1",
  accountId: "a1",
  startDate: "2026-12-24",
  endDate: "2026-12-25",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("time-off and closure validation", () => {
  it("requires a personal time-off resource", () => {
    expect(() => sanitizeWrite("timeOff", { ...meta, type: "holiday" })).toThrow(/missing required field.*resourceId/i);
    expect(() => sanitizeWrite("timeOff", { ...meta, resourceId: null, type: "holiday" })).toThrow(/resourceId/i);
  });

  it("accepts a closure without a resource reference", () => {
    const sanitized = sanitizeWrite("closures", { ...meta, name: "Christmas shutdown" });
    expect(sanitized).not.toHaveProperty("resourceId");
    expect(() => validateWrite(emptyAppData(), "closures", sanitized)).not.toThrow();
  });

  it("rejects a closure carrying a resource reference", () => {
    expect(() => sanitizeWrite("closures", { ...meta, name: "Christmas shutdown", resourceId: "r1" })).toThrow(
      /closure.*resource/i,
    );
  });

  it("rejects a blank closure name", () => {
    expect(() => sanitizeWrite("closures", { ...meta, name: "   " })).toThrow(/closure name is required/i);
  });

  it("rejects reversed closure dates", () => {
    expect(() =>
      validateWrite(emptyAppData(), "closures", {
        ...meta,
        name: "Christmas shutdown",
        endDate: "2026-12-23",
      }),
    ).toThrow(/end date cannot be before the start date/i);
  });
});
