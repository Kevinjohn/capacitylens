import type { Db } from "../../db";
import { removePrincipalSessionAssurance, removeSecurityRevision } from "../state";
import type { IdentityTableProbes } from "./contracts";
import type { MasqueradeSessionLifecycle } from "./contracts";
import { parseAccountLinkUserId } from "./verificationState";

type ErasureTables = Pick<
  IdentityTableProbes,
  | "accountTableExists"
  | "sessionTableExists"
  | "userTableExists"
  | "verificationTableExists"
  | "twoFactorTableExists"
  | "federatedLinkObservationsTableExists"
  | "federatedLinkCeremoniesTableExists"
>;

function eraseVerificationState(db: Db, principals: ReadonlySet<string>): void {
  const rows = db.prepare(`SELECT id, value FROM verification WHERE instr(value, '{') > 0`).all() as Array<{
    id: string;
    value: string;
  }>;
  const verificationIds = rows
    .filter(({ value }) => {
      if (principals.has(value)) return true;
      const linkedPrincipalId = parseAccountLinkUserId(value);
      return linkedPrincipalId !== null && principals.has(linkedPrincipalId);
    })
    .map(({ id }) => id);
  db.prepare(`DELETE FROM verification WHERE value IN (SELECT value FROM json_each(?))`).run(
    JSON.stringify([...principals]),
  );
  if (verificationIds.length === 0) return;
  db.prepare(`DELETE FROM verification WHERE id IN (SELECT value FROM json_each(?))`).run(
    JSON.stringify(verificationIds),
  );
}

function createPrincipalRowEraser(db: Db, tables: ErasureTables): (principalId: string) => void {
  const removeObservation = tables.federatedLinkObservationsTableExists(db)
    ? db.prepare(`DELETE FROM capacitylens_federated_link_observations WHERE principalId = ?`)
    : null;
  const removeCeremony = tables.federatedLinkCeremoniesTableExists(db)
    ? db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`)
    : null;
  const removeSession = tables.sessionTableExists(db) ? db.prepare(`DELETE FROM session WHERE userId = ?`) : null;
  const removeAccount = tables.accountTableExists(db) ? db.prepare(`DELETE FROM account WHERE userId = ?`) : null;
  const removeTwoFactor = tables.twoFactorTableExists(db) ? db.prepare(`DELETE FROM twoFactor WHERE userId = ?`) : null;
  const removeUser = db.prepare(`DELETE FROM user WHERE id = ?`);
  return (principalId) => {
    removeObservation?.run(principalId);
    removeCeremony?.run(principalId);
    removePrincipalSessionAssurance(db, principalId);
    removeSession?.run(principalId);
    removeAccount?.run(principalId);
    removeTwoFactor?.run(principalId);
    removeUser.run(principalId);
    removeSecurityRevision(db, principalId);
  };
}

export function createErasure(tables: ErasureTables) {
  /** Delete only these installation-local Better Auth identities inside the caller's transaction. */
  function eraseLocalPrincipalsInTx(
    db: Db,
    principalIds: readonly string[],
    lifecycle?: MasqueradeSessionLifecycle,
  ): readonly string[] {
    const principals = new Set(principalIds);
    if (principals.size === 0 || !tables.userTableExists(db)) return [];
    const masqueradeHandles = lifecycle?.prepareUsers([...principals], "session_revoked") ?? [];

    if (tables.verificationTableExists(db)) {
      // Scalar reset/email ceremonies can be removed entirely inside SQLite. Structured account-link
      // state still needs the fail-closed decoder below, but only values containing an object opener
      // can possibly carry that JSON shape; do not copy every opaque ceremony into JavaScript.
      // JSON1 is already a schema prerequisite (command resultJson uses json_valid). Passing each set
      // as one JSON parameter avoids both a variable-count SQL string and one table scan per principal.
      eraseVerificationState(db, principals);
    }

    const erasePrincipalRows = createPrincipalRowEraser(db, tables);
    for (const principalId of principals) erasePrincipalRows(principalId);
    return masqueradeHandles;
  }
  return eraseLocalPrincipalsInTx;
}
