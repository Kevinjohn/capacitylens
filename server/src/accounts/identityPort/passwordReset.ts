import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { createHash } from "node:crypto";
import { RESET_LINK_TTL_SECONDS, mintPasswordResetToken, revokeResetTokensForUser } from "../../auth";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { createProviderFailure } from "./vendorErrors";

type PasswordResetPort = Pick<SsoCutoverIdentityPort, "issuePasswordReset" | "revokePasswordResetCeremony">;

/** Creates password-reset issuance and revocation operations for the local identity store. */
export function createPasswordReset(
  input: Pick<IdentityPortContext["input"], "applicationId" | "auth" | "authMode" | "db">,
): PasswordResetPort {
  return {
    async issuePasswordReset({ targetPrincipalId, command }) {
      if (!allowsPasswordSignIn(input.authMode)) {
        throw new AccountContractError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Password reset is unavailable for an SSO-only installation.",
          retryable: false,
          commandId: command.commandId,
        });
      }
      try {
        const row = input.db.prepare(`SELECT email FROM user WHERE id = ?`).get(targetPrincipalId) as
          { email: string } | undefined;
        if (!row?.email) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        const token = await mintPasswordResetToken(input.auth, row.email);
        if (!token) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        return {
          ceremonyId: createHash("sha256")
            .update(`${input.applicationId}-reset-ceremony\0`)
            .update(token)
            .digest("base64url"),
          token,
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString(),
        };
      } catch (error) {
        // Preserve recognized account failures and surface unexpected identity-store failures as dependency errors with their cause.
        if (error instanceof AccountContractError) throw error;
        throw createProviderFailure("Password-reset issuance is temporarily unavailable.", error);
      }
    },
    async revokePasswordResetCeremony({ targetPrincipalId }): Promise<void> {
      try {
        // Better Auth hashes ceremony identifiers at rest, so targeted deletion is unavailable.
        // Conservatively revoking every outstanding ceremony for this principal is fail-closed.
        revokeResetTokensForUser(input.db, targetPrincipalId);
      } catch (error) {
        // Surface identity-store failures as dependency errors while preserving their cause for diagnostics.
        throw createProviderFailure("Password-reset ceremony revocation failed.", error);
      }
    },
  };
}
