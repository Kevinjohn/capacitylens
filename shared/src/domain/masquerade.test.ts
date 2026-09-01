import { describe, expect, it } from "vitest";
import { MASQUERADE_END_REASONS, MASQUERADE_ERROR_CODES } from "./masquerade";

describe("masquerade contracts", () => {
  it("keeps the public end reasons and error codes stable", () => {
    expect(MASQUERADE_END_REASONS).toEqual([
      "explicit",
      "account_switch",
      "sign_out",
      "session_expired",
      "session_revoked",
      "caller_invalidated",
      "target_invalidated",
    ]);
    expect(MASQUERADE_ERROR_CODES).toEqual({
      active: "MASQUERADE_ACTIVE",
      readOnly: "MASQUERADE_READ_ONLY",
      ended: "MASQUERADE_ENDED",
    });
  });
});
