import type { Db } from "../../db";
import { removePrincipalSessionAssurance, removeSecurityRevision } from "../state";
import type { IdentityTableProbes } from "./contracts";
import type { MasqueradeSessionLifecycle } from "./contracts";
import { accountLinkUserId } from "./verificationState";

export function createErasure(
  tables: Pick<
    IdentityTableProbes,
    | "accountTableExists"
    | "sessionTableExists"
    | "userTableExists"
    | "verificationTableExists"
    | "twoFactorTableExists"
    | "federatedLinkObservationsTableExists"
    | "federatedLinkCeremoniesTableExists"
  >,
) {
  const {
    accountTableExists,
    sessionTableExists,
    userTableExists,
    verificationTableExists,
    twoFactorTableExists,
    federatedLinkObservationsTableExists,
    federatedLinkCeremoniesTableExists,
  } = tables;
  /** Delete only these installation-local Better Auth identities inside the caller's transaction. */
  function eraseLocalPrincipalsInTx(
    db: Db,
    principalIds: readonly string[],
    lifecycle?: MasqueradeSessionLifecycle,
  ): readonly string[] {
    const principals = new Set(principalIds);
    if (principals.size === 0 || !userTableExists(db)) return [];
    const masqueradeHandles = lifecycle?.prepareUsers([...principals], "session_revoked") ?? [];

    if (verificationTableExists(db)) {
      // Scalar reset/email ceremonies can be removed entirely inside SQLite. Structured account-link
      // state still needs the fail-closed decoder below, but only values containing an object opener
      // can possibly carry that JSON shape; do not copy every opaque ceremony into JavaScript.
      const rows = db.prepare(`SELECT id, value FROM verification WHERE instr(value, '{') > 0`).all() as Array<{
        id: string;
        value: string;
      }>;
      const verificationIds: string[] = [];
      for (const row of rows) {
        if (principals.has(row.value)) {
          verificationIds.push(row.id);
          continue;
        }
        const linkedPrincipalId = accountLinkUserId(row.value);
        if (linkedPrincipalId !== null && principals.has(linkedPrincipalId)) {
          verificationIds.push(row.id);
        }
      }
      // JSON1 is already a schema prerequisite (command resultJson uses json_valid). Passing each set
      // as one JSON parameter avoids both a variable-count SQL string and one table scan per principal.
      db.prepare(`DELETE FROM verification WHERE value IN (SELECT value FROM json_each(?))`).run(
        JSON.stringify([...principals]),
      );
      if (verificationIds.length > 0) {
        db.prepare(`DELETE FROM verification WHERE id IN (SELECT value FROM json_each(?))`).run(
          JSON.stringify(verificationIds),
        );
      }
    }

    const removeSession = sessionTableExists(db) ? db.prepare(`DELETE FROM session WHERE userId = ?`) : null;
    const removeAccount = accountTableExists(db) ? db.prepare(`DELETE FROM account WHERE userId = ?`) : null;
    const removeTwoFactor = twoFactorTableExists(db) ? db.prepare(`DELETE FROM twoFactor WHERE userId = ?`) : null;
    const removeUser = db.prepare(`DELETE FROM user WHERE id = ?`);
    for (const principalId of principals) {
      if (federatedLinkObservationsTableExists(db)) {
        db.prepare(`DELETE FROM capacitylens_federated_link_observations WHERE principalId = ?`).run(principalId);
      }
      if (federatedLinkCeremoniesTableExists(db)) {
        db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`).run(principalId);
      }
      removePrincipalSessionAssurance(db, principalId);
      removeSession?.run(principalId);
      removeAccount?.run(principalId);
      removeTwoFactor?.run(principalId);
      removeUser.run(principalId);
      removeSecurityRevision(db, principalId);
    }
    return masqueradeHandles;
  }
  return eraseLocalPrincipalsInTx;
}
