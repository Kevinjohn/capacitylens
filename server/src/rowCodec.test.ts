import { describe, expect, it } from "vitest";
import { TABLES } from "./tables";
import { fromRow, toRow } from "./rowCodec";

describe("rowCodec", () => {
  const spec = TABLES.accounts;

  it("encodes JSON columns and collapses absent optionals to SQL null", () => {
    const cells = toRow(spec, {
      id: "a1",
      name: "Studio",
      color: "#fff",
      weekStartsOn: 0,
      disciplinesEnabled: false,
      createdAt: "created",
      updatedAt: "updated",
    });
    const byName = Object.fromEntries(spec.columns.map((column, index) => [column.name, cells[index]]));
    expect(byName.weekStartsOn).toBe("0");
    expect(byName.disciplinesEnabled).toBe("false");
    expect(byName.timezone).toBeNull();
  });

  it("decodes JSON, omits optional nulls, and retains required nulls for validation", () => {
    expect(
      fromRow(spec, {
        id: "a1",
        name: null,
        color: "#fff",
        weekStartsOn: "1",
        timezone: null,
        createdAt: "created",
        updatedAt: "updated",
      }),
    ).toMatchObject({ id: "a1", name: null, weekStartsOn: 1 });
    expect(
      fromRow(spec, { id: "a1", name: "Studio", color: "#fff", timezone: null, createdAt: "c", updatedAt: "u" }),
    ).not.toHaveProperty("timezone");
  });

  it("identifies corrupt JSON by table, column and row", () => {
    expect(() =>
      fromRow(spec, {
        id: "a-broken",
        name: "Studio",
        color: "#fff",
        weekStartsOn: "not-json",
        createdAt: "c",
        updatedAt: "u",
      }),
    ).toThrow(/Corrupt JSON in accounts\.weekStartsOn \(id=a-broken\)/);
  });
});
