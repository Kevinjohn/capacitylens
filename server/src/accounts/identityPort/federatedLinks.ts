import { AccountContractError } from "@capacitylens/shared/account/errors";
import { enqueueAudit } from "../../auditOutbox";
import { revokeFederatedLinkStateInTx, revokeResetTokensForUser } from "../../auth";
import { tx } from "../../txn";
import { getProviderIdForIssuer } from "../state";
import type { FederatedLinkRemoval, IdentityPortContext, SsoCutoverIdentityPort } from "./contracts";
import {
  createInvalidProviderSessionError,
  isDuplicateCredentialEmailError,
  createProviderFailure,
} from "./vendorErrors";

type FederatedLinksContext = Pick<
  IdentityPortContext,
  | "input"
  | "federatedLinkObservationsTableExists"
  | "federatedLinkCeremoniesTableExists"
  | "revokePrincipalSessionsInTx"
>;

interface RemoveFederatedLinkInput {
  removal: FederatedLinkRemoval;
  preserveSignIn: boolean;
  authorizeInTransaction?: (() => void) | undefined;
}

function linkChangedError(): AccountContractError {
  return new AccountContractError({
    code: "CONFLICT",
    message: "The provider link changed after it was inspected. Refresh and try again.",
    retryable: false,
  });
}

function identityNotFoundError(): AccountContractError {
  return new AccountContractError({
    code: "NOT_FOUND",
    message: "No local sign-in identity exists for this member.",
    retryable: false,
  });
}

function identityAlreadyExistsError(cause?: unknown): AccountContractError {
  const failure = {
    code: "IDENTITY_ALREADY_EXISTS" as const,
    message: "A sign-in identity already exists for that email address.",
    retryable: false,
  };
  return cause === undefined ? new AccountContractError(failure) : new AccountContractError(failure, { cause });
}

function assertFederatedProvider(providerId: string): void {
  if (providerId !== "credential") return;
  throw new AccountContractError({
    code: "VALIDATION_FAILED",
    message: "Password credentials are not federated provider links.",
    retryable: false,
  });
}

function assertViableSignInMethod(context: FederatedLinksContext, principalId: string, rowId: string): void {
  const { auth, db } = context.input;
  const methods = db
    .prepare(`SELECT providerId, password FROM account WHERE userId = ? AND id <> ? ORDER BY id`)
    .all(principalId, rowId) as Array<{ providerId: string; password: string | null }>;
  const viable = methods.some(({ providerId, password }) =>
    providerId === "credential"
      ? typeof password === "string" && password.length > 0
      : auth.federatedIssuers.has(providerId),
  );
  if (viable) return;
  throw new AccountContractError({
    code: "CONFLICT",
    message: "This provider link is the principal's only viable sign-in method and cannot be removed.",
    retryable: false,
  });
}

function deleteFederatedLink(context: FederatedLinksContext, removal: FederatedLinkRemoval): void {
  const { db } = context.input;
  const { principalId, providerId, rowId, subject } = removal;
  if (context.federatedLinkObservationsTableExists(db)) {
    db.prepare(`DELETE FROM capacitylens_federated_link_observations WHERE accountRowId = ?`).run(rowId);
  }
  const removed = db
    .prepare(`DELETE FROM account WHERE id = ? AND userId = ? AND providerId = ? AND accountId = ?`)
    .run(rowId, principalId, providerId, subject);
  if (removed.changes !== 1) throw linkChangedError();
  if (context.federatedLinkCeremoniesTableExists(db)) {
    db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ? AND providerId = ?`).run(
      principalId,
      providerId,
    );
  }
}

function removeFederatedLinkInTx(
  context: FederatedLinksContext,
  input: RemoveFederatedLinkInput,
): readonly string[] | false {
  const { applicationId, db, masqueradeSessions } = context.input;
  const { removal, preserveSignIn, authorizeInTransaction } = input;
  const { principalId, providerId, rowId, subject, audit } = removal;
  authorizeInTransaction?.();
  const row = db
    .prepare(`SELECT id, accountId FROM account WHERE id = ? AND userId = ? AND providerId = ?`)
    .get(rowId, principalId, providerId) as { id: string; accountId: string } | undefined;
  if (!row) return false;
  if (row.accountId !== subject) throw linkChangedError();
  if (preserveSignIn) assertViableSignInMethod(context, principalId, rowId);
  const handles = context.revokePrincipalSessionsInTx({
    db,
    applicationId,
    principalId,
    lifecycle: masqueradeSessions,
  });
  deleteFederatedLink(context, removal);
  revokeFederatedLinkStateInTx(db, principalId);
  enqueueAudit(db, audit, audit.id);
  return handles;
}

function createRemoveFederatedLink(context: FederatedLinksContext) {
  return async (input: RemoveFederatedLinkInput): Promise<boolean> => {
    assertFederatedProvider(input.removal.providerId);
    try {
      const handles = tx(context.input.db, () => removeFederatedLinkInTx(context, input), "immediate");
      context.input.masqueradeSessions?.commit(handles === false ? [] : handles);
      return handles !== false;
    } catch (error) {
      if (error instanceof AccountContractError) throw error;
      throw createProviderFailure("Federated identity repair failed.", error);
    }
  };
}

function createFindPrincipalByFederatedSubject(
  context: FederatedLinksContext,
): SsoCutoverIdentityPort["findPrincipalByFederatedSubject"] {
  const { applicationId, db } = context.input;
  return async ({ subject }: Parameters<SsoCutoverIdentityPort["findPrincipalByFederatedSubject"]>[0]) => {
    try {
      // The identity key excludes email so it can never correlate two product identities.
      const providerId = getProviderIdForIssuer(db, applicationId, subject.issuer);
      if (!providerId) return null;
      const rows = db
        .prepare(
          `SELECT u.id, u.name, u.email FROM account AS a JOIN user AS u ON u.id = a.userId
           WHERE a.providerId = ? AND a.accountId = ? LIMIT 2`,
        )
        .all(providerId, subject.subject) as Array<{ id: string; name: string | null; email: string | null }>;
      if (rows.length > 1) {
        throw createInvalidProviderSessionError("The federated subject maps to more than one local principal.");
      }
      const row = rows[0];
      return row ? { id: row.id, displayName: row.name, email: row.email } : null;
    } catch (error) {
      if (error instanceof AccountContractError) throw error;
      throw createProviderFailure("Federated identity lookup is temporarily unavailable.", error);
    }
  };
}

function correctPrincipalEmailInTx(
  context: FederatedLinksContext,
  input: Parameters<SsoCutoverIdentityPort["correctPrincipalEmail"]>[0],
): readonly string[] {
  const { applicationId, db, masqueradeSessions } = context.input;
  const { principalId, email, audit, authorizeInTransaction } = input;
  authorizeInTransaction();
  const current = db.prepare(`SELECT email FROM user WHERE id = ?`).get(principalId) as { email: string } | undefined;
  if (!current) throw identityNotFoundError();
  const collision = db.prepare(`SELECT id FROM user WHERE email = ? AND id <> ?`).get(email, principalId);
  if (collision) throw identityAlreadyExistsError();
  const changed = db
    .prepare(`UPDATE user SET email = ?, emailVerified = 1, updatedAt = ? WHERE id = ?`)
    .run(email, Date.now(), principalId);
  if (changed.changes !== 1) throw identityNotFoundError();
  revokeResetTokensForUser(db, principalId);
  revokeFederatedLinkStateInTx(db, principalId);
  db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`).run(principalId);
  const handles = context.revokePrincipalSessionsInTx({
    db,
    applicationId,
    principalId,
    lifecycle: masqueradeSessions,
  });
  enqueueAudit(db, audit, audit.id);
  return handles;
}

function createCorrectPrincipalEmail(context: FederatedLinksContext) {
  return async (input: Parameters<SsoCutoverIdentityPort["correctPrincipalEmail"]>[0]): Promise<void> => {
    try {
      const handles = tx(context.input.db, () => correctPrincipalEmailInTx(context, input), "immediate");
      context.input.masqueradeSessions?.commit(handles);
    } catch (error) {
      if (error instanceof AccountContractError) throw error;
      if (isDuplicateCredentialEmailError(error)) throw identityAlreadyExistsError(error);
      throw createProviderFailure("Identity email correction failed.", error);
    }
  };
}

export function createFederatedLinks(
  context: FederatedLinksContext,
): Pick<
  SsoCutoverIdentityPort,
  | "removeFederatedLink"
  | "removeFederatedLinkForStoppedRepair"
  | "findPrincipalByFederatedSubject"
  | "correctPrincipalEmail"
> {
  const removeFederatedLink = createRemoveFederatedLink(context);
  return {
    removeFederatedLink: (input) =>
      removeFederatedLink({
        removal: input,
        preserveSignIn: true,
        authorizeInTransaction: input.authorizeInTransaction,
      }),
    removeFederatedLinkForStoppedRepair: (input) => removeFederatedLink({ removal: input, preserveSignIn: false }),
    findPrincipalByFederatedSubject: createFindPrincipalByFederatedSubject(context),
    correctPrincipalEmail: createCorrectPrincipalEmail(context),
  };
}
