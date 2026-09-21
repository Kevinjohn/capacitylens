import { describe, it, expect } from "vitest";
import { applyOps } from "./ServerSyncAdapter";
import { client, withData } from "./ServerSyncAdapter.testSupport";

describe("applyOps", () => {
  it("advances a snapshot by the given upserts and deletes", () => {
    const base = withData({ clients: [client("c1"), client("c2")] });
    const next = applyOps(base, [
      { method: "PUT", table: "clients", id: "c3", row: client("c3") },
      { method: "DELETE", table: "clients", id: "c1" },
    ]);
    expect(next.clients.map((c) => c.id).sort()).toEqual(["c2", "c3"]); // c1 removed, c3 added
    expect(base.clients.map((c) => c.id).sort()).toEqual(["c1", "c2"]); // base not mutated
  });
});
