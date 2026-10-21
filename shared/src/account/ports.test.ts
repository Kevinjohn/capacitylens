import { describe, expect, it } from "vitest";
import { ACCOUNT_FLOW_OPERATIONS, isAccountFlowOperation } from "./ports";

describe("account flow operation vocabulary", () => {
  it("is immutable and keeps the narrowing guard closed", () => {
    expect(Object.isFrozen(ACCOUNT_FLOW_OPERATIONS)).toBe(true);
    expect(() => (ACCOUNT_FLOW_OPERATIONS as unknown as string[]).push("account-deletion")).toThrow();
    expect(isAccountFlowOperation("account-deletion")).toBe(false);
  });

  it("accepts every declared operation", () => {
    for (const operation of ACCOUNT_FLOW_OPERATIONS) {
      expect(isAccountFlowOperation(operation), operation).toBe(true);
    }
  });

  it("fails closed on non-member and non-string values", () => {
    expect(isAccountFlowOperation("invite-password-signup ")).toBe(false);
    expect(isAccountFlowOperation("")).toBe(false);
    expect(isAccountFlowOperation(null)).toBe(false);
    expect(isAccountFlowOperation(undefined)).toBe(false);
    expect(isAccountFlowOperation(0)).toBe(false);
  });
});
