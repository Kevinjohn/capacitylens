import { describe, expect, it } from "vitest";
import { isScopedEntityKey } from "@capacitylens/shared/types/entities";
import { TABLES } from "./tables";

describe("table authorization classification", () => {
  it("classifies every generic API table as the account root or account-scoped", () => {
    expect(
      Object.keys(TABLES).filter(
        (table) => table !== "accounts" && !isScopedEntityKey(table),
      ),
    ).toEqual([]);
  });
});
