import { describe, it, expect } from "vitest";
import { resolveEntitlements } from "./resolveEntitlements";

// Every account has unlimited entitlements under the current contract.

describe("entitlementsFor (default-unlimited seam, P1.16)", () => {
  it("returns { unlimited: true } for any account id", () => {
    expect(resolveEntitlements("acct-1")).toEqual({ unlimited: true });
    expect(resolveEntitlements("anything")).toEqual({ unlimited: true });
  });
});
