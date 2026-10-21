import { describe, expect, it } from "vitest";
import { isScopedEntityKey } from "@capacitylens/shared/types/entities";
import { assertUniqueTableColumns, TABLES } from "./tables";

describe("table authorization classification", () => {
  it("classifies every generic API table as the account root or account-scoped", () => {
    expect(Object.keys(TABLES).filter((table) => table !== "accounts" && !isScopedEntityKey(table))).toEqual([]);
  });
});

describe("table column definitions", () => {
  it("keeps every current table's column names unique", () => {
    for (const table of Object.values(TABLES)) {
      expect(() => assertUniqueTableColumns(table.key, table.columns)).not.toThrow();
    }
  });

  it("rejects a duplicate column with a table-specific diagnostic", () => {
    expect(() => assertUniqueTableColumns("clients", [{ name: "id" }, { name: "id" }])).toThrow(
      'Table "clients" declares column "id" more than once.',
    );
  });
});
