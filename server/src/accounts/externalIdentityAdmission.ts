import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";

export interface ExternalIdentityCandidate {
  email?: string;
  emailVerified?: boolean;
}

/**
 * Embedded admission coordinator used before the identity adapter creates a federated local
 * principal. Identity storage owns the "first principal" fact; the account adapter owns the
 * invitation fact. Email authorizes admission but is never the durable link key.
 */
export function localExternalIdentityAdmission(input: {
  bootstrapEmails: string | undefined;
  candidate: ExternalIdentityCandidate;
  identityHasAnyPrincipal: () => boolean;
  hasLivePreauthorizedInvitation: (normalizedEmail: string) => boolean;
}): boolean {
  if (input.candidate.emailVerified !== true || !input.candidate.email) return false;
  const normalizedEmail = normalizeAccountEmail(input.candidate.email);
  if (!isAccountEmail(normalizedEmail)) return false;
  const allowList = (input.bootstrapEmails ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  // First-owner admission is a distinct operator ceremony. A pre-existing/dangling invitation
  // must never replace the explicit bootstrap allow-list merely because the local user table is
  // empty (for example after erasure or while restoring control-plane data).
  if (!input.identityHasAnyPrincipal()) return allowList.includes(normalizedEmail);
  return input.hasLivePreauthorizedInvitation(normalizedEmail);
}
