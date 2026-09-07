import { describe, expect, it } from "vitest";
import type { ScopedEntity } from "../types/entities";
import { belongsToAccount, byAccount, notInAccount } from "./tenancy";

const rows = [
  { id: "a-row", accountId: "a" },
  { id: "b-row", accountId: "b" },
  { id: "a-row-2", accountId: "a" },
] as ScopedEntity[];

describe("tenant predicates", () => {
  it("compares the exact account id", () => {
    expect(belongsToAccount(rows[0], "a")).toBe(true);
    expect(belongsToAccount(rows[0], "A")).toBe(false);
    expect(belongsToAccount(rows[0], "b")).toBe(false);
  });

  it("partitions a mixed table exactly without changing row identity", () => {
    const owned = rows.filter(byAccount("a"));
    const remaining = rows.filter(notInAccount("a"));

    expect(owned).toEqual([rows[0], rows[2]]);
    expect(remaining).toEqual([rows[1]]);
    expect([...owned, ...remaining]).toHaveLength(rows.length);
    expect(new Set([...owned, ...remaining])).toEqual(new Set(rows));
  });
});
