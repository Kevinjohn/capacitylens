import type { AuthMode } from "../auth/authContext";
import { isAccountEmail } from "@capacitylens/shared/account/validation";

export type InvitationEmailValidation =
  { kind: "valid"; email: string } | { kind: "invalid"; reason: "required" | "format" };

/** Shared invitation email rules for Team & access and resource-first invitations. */
export function validateInvitationEmail(authMode: AuthMode, email: string): InvitationEmailValidation {
  const trimmed = email.trim();
  if (authMode === "sso" && trimmed.length === 0) return { kind: "invalid", reason: "required" };
  if (trimmed.length > 0 && !isAccountEmail(trimmed)) return { kind: "invalid", reason: "format" };
  return { kind: "valid", email: trimmed };
}
