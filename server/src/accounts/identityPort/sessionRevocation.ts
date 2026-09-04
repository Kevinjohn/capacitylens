import type { Db } from "../../db";
import { applicationSessionHandle } from "../sessionHandle";
import { removePrincipalSessionAssurance, removeSessionAssurance } from "../state";
import type { IdentityTableProbes } from "./contracts";
import type { MasqueradeSessionLifecycle } from "./contracts";

export function createSessionRevocation(tables: Pick<IdentityTableProbes, "sessionTableExists">) {
  const { sessionTableExists } = tables;
  /** Delete a principal's provider sessions and app-owned assurance inside the caller's SQLite
   * transaction. This is used by identity corrections/repairs so no sign-in can land between a
   * pre-mutation revocation and the mutation itself. */
  function revokePrincipalSessionsInTx(
    db: Db,
    applicationId: string,
    principalId: string,
    lifecycle?: MasqueradeSessionLifecycle,
  ): readonly string[] {
    const masqueradeHandles = lifecycle?.prepareUsers([principalId], "session_revoked") ?? [];
    if (!sessionTableExists(db)) {
      removePrincipalSessionAssurance(db, principalId);
      return masqueradeHandles;
    }
    const sessions = db.prepare(`SELECT token FROM session WHERE userId = ?`).all(principalId) as Array<{
      token: string;
    }>;
    db.prepare(`DELETE FROM session WHERE userId = ?`).run(principalId);
    for (const { token } of sessions) {
      removeSessionAssurance(db, applicationSessionHandle(applicationId, token));
    }
    removePrincipalSessionAssurance(db, principalId);
    return masqueradeHandles;
  }
  return revokePrincipalSessionsInTx;
}
