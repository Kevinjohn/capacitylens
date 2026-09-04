import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { PrincipalSummary } from "@capacitylens/shared/account/types";
import { enqueueAudit } from "../../auditOutbox";
import { revokeFederatedLinkStateInTx, revokeResetTokensForUser } from "../../auth";
import { tx } from "../../txn";
import { providerIdForIssuer } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { FederatedLinkRemoval, SsoCutoverIdentityPort } from "./contracts";
import { invalidProviderSession, isDuplicateCredentialEmailError, providerFailure } from "./vendorErrors";

export function createFederatedLinks(
  context: Pick<
    IdentityPortContext,
    | "input"
    | "federatedLinkObservationsTableExists"
    | "federatedLinkCeremoniesTableExists"
    | "revokePrincipalSessionsInTx"
  >,
): Pick<
  SsoCutoverIdentityPort,
  | "removeFederatedLink"
  | "removeFederatedLinkForStoppedRepair"
  | "findPrincipalByFederatedSubject"
  | "correctPrincipalEmail"
> {
  const {
    input,
    federatedLinkObservationsTableExists,
    federatedLinkCeremoniesTableExists,
    revokePrincipalSessionsInTx,
  } = context;
  const { applicationId, auth, db } = input;
  const removeFederatedLink = async (
    { principalId, providerId, rowId, subject, audit }: FederatedLinkRemoval,
    preserveSignIn: boolean,
    authorizeInTransaction?: () => void,
  ): Promise<boolean> => {
    if (providerId === "credential") {
      throw new AccountContractError({
        code: "VALIDATION_FAILED",
        message: "Password credentials are not federated provider links.",
        retryable: false,
      });
    }
    let masqueradeHandles: readonly string[] = [];
    try {
      const removed = tx(
        db,
        () => {
          authorizeInTransaction?.();
          const row = db
            .prepare(`SELECT id, accountId FROM account WHERE id = ? AND userId = ? AND providerId = ?`)
            .get(rowId, principalId, providerId) as { id: string; accountId: string } | undefined;
          if (!row) return false;
          if (row.accountId !== subject) {
            throw new AccountContractError({
              code: "CONFLICT",
              message: "The provider link changed after it was inspected. Refresh and try again.",
              retryable: false,
            });
          }
          if (preserveSignIn) {
            const remainingSignInMethods = db
              .prepare(
                `SELECT providerId, password
                   FROM account
                  WHERE userId = ?
                    AND id <> ?
                  ORDER BY id`,
              )
              .all(principalId, rowId) as Array<{ providerId: string; password: string | null }>;
            const hasViableSignInMethod = remainingSignInMethods.some(({ providerId: candidate, password }) =>
              candidate === "credential"
                ? typeof password === "string" && password.length > 0
                : auth.federatedIssuers.has(candidate),
            );
            if (!hasViableSignInMethod) {
              throw new AccountContractError({
                code: "CONFLICT",
                message: "This provider link is the principal's only viable sign-in method and cannot be removed.",
                retryable: false,
              });
            }
          }
          masqueradeHandles = revokePrincipalSessionsInTx(db, applicationId, principalId, input.masqueradeSessions);
          if (federatedLinkObservationsTableExists(db)) {
            db.prepare(`DELETE FROM capacitylens_federated_link_observations WHERE accountRowId = ?`).run(rowId);
          }
          const removed = db
            .prepare(`DELETE FROM account WHERE id = ? AND userId = ? AND providerId = ? AND accountId = ?`)
            .run(rowId, principalId, providerId, subject);
          if (removed.changes !== 1) {
            throw new AccountContractError({
              code: "CONFLICT",
              message: "The provider link changed after it was inspected. Refresh and try again.",
              retryable: false,
            });
          }
          if (federatedLinkCeremoniesTableExists(db)) {
            db.prepare(
              `DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ? AND providerId = ?`,
            ).run(principalId, providerId);
          }
          revokeFederatedLinkStateInTx(db, principalId);
          enqueueAudit(db, audit, audit.id);
          return true;
        },
        "immediate",
      );
      input.masqueradeSessions?.commit(masqueradeHandles);
      return removed;
    } catch (error) {
      if (error instanceof AccountContractError) throw error;
      throw providerFailure("Federated identity repair failed.", error);
    }
  };
  return {
    removeFederatedLink(input) {
      return removeFederatedLink(input, true, input.authorizeInTransaction);
    },
    removeFederatedLinkForStoppedRepair(input) {
      return removeFederatedLink(input, false);
    },
    async findPrincipalByFederatedSubject({ subject }): Promise<PrincipalSummary | null> {
      try {
        // The identity key is the provider/issuer plus upstream subject pair. Email is deliberately
        // absent from this lookup and can never correlate two product identities.
        const providerId = providerIdForIssuer(db, applicationId, subject.issuer);
        if (!providerId) return null;
        const rows = db
          .prepare(
            `
          SELECT u.id, u.name, u.email
            FROM account AS a
            JOIN user AS u ON u.id = a.userId
           WHERE a.providerId = ? AND a.accountId = ?
           LIMIT 2
        `,
          )
          .all(providerId, subject.subject) as Array<{
          id: string;
          name: string | null;
          email: string | null;
        }>;
        if (rows.length > 1) {
          throw invalidProviderSession("The federated subject maps to more than one local principal.");
        }
        const row = rows[0];
        return row ? { id: row.id, displayName: row.name, email: row.email } : null;
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Federated identity lookup is temporarily unavailable.", error);
      }
    },
    async correctPrincipalEmail({ principalId, email, audit, authorizeInTransaction }) {
      let masqueradeHandles: readonly string[] = [];
      try {
        tx(
          db,
          () => {
            authorizeInTransaction();
            const current = db.prepare(`SELECT email FROM user WHERE id = ?`).get(principalId) as
              { email: string } | undefined;
            if (!current) {
              throw new AccountContractError({
                code: "NOT_FOUND",
                message: "No local sign-in identity exists for this member.",
                retryable: false,
              });
            }
            const collision = db.prepare(`SELECT id FROM user WHERE email = ? AND id <> ?`).get(email, principalId);
            if (collision) {
              throw new AccountContractError({
                code: "IDENTITY_ALREADY_EXISTS",
                message: "A sign-in identity already exists for that email address.",
                retryable: false,
              });
            }
            const changed = db
              .prepare(`UPDATE user SET email = ?, emailVerified = 1, updatedAt = ? WHERE id = ?`)
              .run(email, Date.now(), principalId);
            if (changed.changes !== 1) {
              throw new AccountContractError({
                code: "NOT_FOUND",
                message: "No local sign-in identity exists for this member.",
                retryable: false,
              });
            }
            revokeResetTokensForUser(db, principalId);
            revokeFederatedLinkStateInTx(db, principalId);
            db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`).run(principalId);
            masqueradeHandles = revokePrincipalSessionsInTx(db, applicationId, principalId, input.masqueradeSessions);
            enqueueAudit(db, audit, audit.id);
          },
          "immediate",
        );
        input.masqueradeSessions?.commit(masqueradeHandles);
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        if (isDuplicateCredentialEmailError(error)) {
          throw new AccountContractError(
            {
              code: "IDENTITY_ALREADY_EXISTS",
              message: "A sign-in identity already exists for that email address.",
              retryable: false,
            },
            { cause: error },
          );
        }
        throw providerFailure("Identity email correction failed.", error);
      }
    },
  };
}
