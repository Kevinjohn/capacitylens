import { describe, expect, it } from "vitest";
import { validateInvitationEmail } from "./invitationValidation";

describe("validateInvitationEmail", () => {
  it("requires the preauthorised address for SSO and trims valid addresses", () => {
    expect(validateInvitationEmail("sso", "   ")).toEqual({ kind: "invalid", reason: "required" });
    expect(validateInvitationEmail("sso", "  member@example.test ")).toEqual({
      kind: "valid",
      email: "member@example.test",
    });
  });

  it("allows a generic password-mode invite but rejects malformed addresses", () => {
    expect(validateInvitationEmail("password", "")).toEqual({ kind: "valid", email: "" });
    expect(validateInvitationEmail("password", "not-an-email")).toEqual({ kind: "invalid", reason: "format" });
  });
});
