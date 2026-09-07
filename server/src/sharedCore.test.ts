import { describe, it, expect } from "vitest";
import { assertDateRange, remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";

// Proves the client's pure domain-core actually imports and executes under Node
// (the server runtime), not just in the browser/jsdom. The exhaustive rule coverage
// lives in src/domain/mutations.test.ts; this is the cross-runtime smoke test that
// the shared seam holds.

describe("shared domain-core runs under Node", () => {
  it("assertDateRange enforces ordering", () => {
    expect(() => assertDateRange("2026-01-01", "2026-01-05")).not.toThrow();
    expect(() => assertDateRange("2026-01-05", "2026-01-01")).toThrow();
  });

  it("remapAndValidateImport remaps ids and drops invalid rows", () => {
    const base: AppData = {
      ...emptyAppData(),
      accounts: [{ id: "a1", name: "Co", color: "#3b82f6", createdAt: "t", updatedAt: "t" }],
    };
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [{ id: "c", accountId: "x", name: "Acme", color: "#3b82f6", createdAt: "t", updatedAt: "t" }],
    };
    const out = remapAndValidateImport(base, "a1", incoming, "2026-01-01T00:00:00.000Z");
    expect(out.imported).toBe(1);
    const importedClient = out.data.clients[0];
    if (!importedClient) throw new Error("Expected one imported client.");
    expect(importedClient.id).not.toBe("c");
    expect(importedClient.accountId).toBe("a1");
    expect(importedClient.createdAt).toBe("2026-01-01T00:00:00.000Z"); // store/server owns the clock
  });
});
