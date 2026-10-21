import { describe, expect, it } from "vitest";
import { isSsoReadinessReason, SSO_READINESS_REASONS } from "./ssoCutover";

describe("SSO readiness-reason runtime guard", () => {
  it("accepts every published SSO readiness reason", () => {
    for (const reason of SSO_READINESS_REASONS) {
      expect(isSsoReadinessReason(reason), reason).toBe(true);
    }
  });

  it("rejects invalid runtime values", () => {
    const invalidReasons: readonly unknown[] = [
      null,
      undefined,
      false,
      0,
      {},
      "ready ",
      "Ready",
      "workspace_not_ready",
    ];

    for (const reason of invalidReasons) {
      expect(isSsoReadinessReason(reason), String(reason)).toBe(false);
    }
  });
});
