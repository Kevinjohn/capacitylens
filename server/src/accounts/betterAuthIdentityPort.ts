import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { ProvisionalPrincipal } from "@capacitylens/shared/account/types";
import { createHash, randomBytes } from "node:crypto";
import { cachedTableExists, secretTokenMatches } from "../auth";
import { tx, type SynchronousCallback } from "../txn";
import type { IdentityPortInput } from "./identityPort/contracts";
import type { SsoCutoverIdentityPort } from "./identityPort/contracts";
import { createCredentials } from "./identityPort/credentials";
import { createCutover } from "./identityPort/cutover";
import { createErasure } from "./identityPort/erasure";
import { createFederatedLinks } from "./identityPort/federatedLinks";
import { createInspection } from "./identityPort/inspection";
import { createSessionRevocation } from "./identityPort/sessionRevocation";
import { createSessions } from "./identityPort/sessions";
import { erasePrincipalCommandHistoryInTx } from "./state";

export type { LocalIdentityPort, SsoCutoverIdentityFacts, SsoCutoverIdentityPort } from "./identityPort/contracts";

// Per-handle-cached table probes (see auth.ts's cachedTableExists): each of these tables is only
// ever created, never dropped, so caching a positive probe permanently is safe; a negative probe
// keeps re-checking so a same-handle migration that creates the table later is still observed.
const accountTableExists = cachedTableExists("account");
const sessionTableExists = cachedTableExists("session");
const userTableExists = cachedTableExists("user");
const verificationTableExists = cachedTableExists("verification");
const twoFactorTableExists = cachedTableExists("twoFactor");
const federatedLinkObservationsTableExists = cachedTableExists("capacitylens_federated_link_observations");
const federatedLinkCeremoniesTableExists = cachedTableExists("capacitylens_federated_link_ceremonies");
const accountSessionAssuranceTableExists = cachedTableExists("account_session_assurance");
/** Better Auth and SQLite mechanics narrowed behind the provider-neutral IdentityPort. */

export function betterAuthIdentityPort(input: IdentityPortInput): SsoCutoverIdentityPort {
  // Handles are valid only for this port instance; inject both operations with this same key.
  const compensationKey = randomBytes(32);
  const makeCompensationHandle = (principalId: string, commandId: string): string =>
    createHash("sha256")
      .update(compensationKey)
      .update("\0")
      .update(principalId)
      .update("\0")
      .update(commandId)
      .digest("base64url");
  const assertCompensationHandle = (provisional: ProvisionalPrincipal, commandId: string): void => {
    if (
      !secretTokenMatches(makeCompensationHandle(provisional.principalId, commandId), provisional.compensationHandle)
    ) {
      throw new AccountContractError({
        code: "FORBIDDEN",
        message: "The provisional-principal compensation handle is invalid.",
        retryable: false,
        commandId,
      });
    }
  };
  const tables = {
    accountTableExists,
    sessionTableExists,
    userTableExists,
    verificationTableExists,
    twoFactorTableExists,
    federatedLinkObservationsTableExists,
    federatedLinkCeremoniesTableExists,
    accountSessionAssuranceTableExists,
  };
  const eraseLocalPrincipalsInTx = createErasure(tables);
  const revokePrincipalSessionsInTx = createSessionRevocation(tables);
  const context = {
    input,
    ...tables,
    makeCompensationHandle,
    assertCompensationHandle,
    eraseLocalPrincipalsInTx,
    revokePrincipalSessionsInTx,
  };
  const { db } = input;
  return {
    deprovisionLocalPrincipalInTx(principalId, exceptCommandId) {
      erasePrincipalCommandHistoryInTx(db, principalId, exceptCommandId);
      return eraseLocalPrincipalsInTx(db, [principalId], input.masqueradeSessions);
    },
    deprovisionLocalPrincipalsInTx(principalIds, exceptCommandId) {
      for (const principalId of new Set(principalIds)) {
        erasePrincipalCommandHistoryInTx(db, principalId, exceptCommandId);
      }
      return eraseLocalPrincipalsInTx(db, principalIds, input.masqueradeSessions);
    },
    commitMasqueradeSessionEnds(sessionHandles) {
      input.masqueradeSessions?.commit(sessionHandles);
    },
    readSsoCutoverSnapshot<Result>(read: () => Result): Result {
      return tx(db, read as SynchronousCallback<typeof read>);
    },
    ...createSessions(context),
    ...createFederatedLinks(context),
    ...createCutover(context),
    ...createInspection(context),
    ...createCredentials(context),
  };
}
