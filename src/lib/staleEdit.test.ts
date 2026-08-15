import { describe, it, expect } from "vitest";
import { isStaleEdit } from "./staleEdit";

interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const row: Row = { id: "a", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("isStaleEdit", () => {
  it("returns false for a fresh row (still present, same updatedAt)", () => {
    expect(isStaleEdit([row], row.id, row.updatedAt)).toBe(false);
  });

  it("returns true when the row's updatedAt has moved on (concurrent write)", () => {
    const changed: Row = { ...row, updatedAt: "2026-01-02T00:00:00.000Z" };
    expect(isStaleEdit([changed], row.id, row.updatedAt)).toBe(true);
  });

  it("returns true when the row is missing entirely (deleted/archived elsewhere)", () => {
    expect(isStaleEdit([], row.id, row.updatedAt)).toBe(true);
  });

  it("is unaffected by other rows in the list", () => {
    const other: Row = { id: "b", createdAt: row.createdAt, updatedAt: row.updatedAt };
    expect(isStaleEdit([other, row], row.id, row.updatedAt)).toBe(false);
  });
});
