import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { enqueueAudit } from "./auditOutbox";
import { tx } from "./txn";

/** Persist one bounded link ceremony, superseding an abandoned attempt for the same identity. */
export function createFederatedLinkCeremony(
  db: Db,
  principalId: string,
  providerId: string,
  ceremonyId = randomBytes(24).toString("base64url"),
  revokeSupersededProviderStateInTransaction: () => void = () => undefined,
) {
  const now = new Date();
  const ceremony = {
    id: ceremonyId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
  return tx(
    db,
    () => {
      db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE expiresAt <= ?`).run(now.toISOString());
      // Beginning again is the explicit cancellation path for an OAuth redirect that was closed or
      // abandoned. Revoke Better Auth's matching state too, so the old callback cannot finish after
      // the replacement ceremony starts.
      revokeSupersededProviderStateInTransaction();
      db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE principalId = ? AND providerId = ?`).run(
        principalId,
        providerId,
      );
      db.prepare(
        `INSERT INTO capacitylens_federated_link_ceremonies
           (id, principalId, providerId, createdAt, expiresAt, completedAt)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(ceremony.id, principalId, providerId, ceremony.createdAt, ceremony.expiresAt);
      return ceremony;
    },
    "immediate",
  );
}

/** Remove an application ceremony after its provider initiation failed before browser hand-off. */
export function deleteFederatedLinkCeremony(db: Db, ceremonyId: string): void {
  db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies WHERE id = ?`).run(ceremonyId);
}

/** Durable account-row observation awaiting idempotent audit reconciliation. */
export interface ObservedFederatedLink {
  accountRowId: string;
  principalId: string;
  providerId: string;
  subject: string;
  verifiedAt: string;
}

/** Deliver every atomically observed external account audit and close ceremonies only when the
 * matching account-row observation—not a redirect query string—proves callback completion. */
export function reconcileObservedFederatedLinks(
  db: Db,
  applicationId: string,
  readVerifiedObservations: () => readonly ObservedFederatedLink[],
): void {
  const observations = readVerifiedObservations();
  const now = new Date().toISOString();
  const ceremonyCleanupPending =
    db
      .prepare(
        `SELECT 1
           FROM capacitylens_federated_link_ceremonies AS ceremony
          WHERE ceremony.expiresAt <= ?
             OR EXISTS (
                  SELECT 1
                    FROM capacitylens_federated_link_observations AS observation
                   WHERE observation.principalId = ceremony.principalId
                     AND observation.providerId = ceremony.providerId
                )
          LIMIT 1`,
      )
      .get(now) !== undefined;
  if (observations.length === 0 && !ceremonyCleanupPending) return;

  tx(
    db,
    () => {
      for (const observation of observations) {
        const auditId = `identity-link:${observation.accountRowId}`;
        enqueueAudit(
          db,
          {
            id: auditId,
            occurredAt: observation.verifiedAt,
            applicationId,
            workspaceId: null,
            actorPrincipalId: observation.principalId,
            targetPrincipalId: observation.principalId,
            commandId: null,
            action: "identity.federated_linked",
            outcome: "success",
            changedFields: ["federatedIdentity"],
          },
          auditId,
        );
        db.prepare(
          `UPDATE capacitylens_federated_link_observations
              SET auditedAt = ?
            WHERE accountRowId = ? AND auditedAt IS NULL`,
        ).run(now, observation.accountRowId);
      }
      db.prepare(
        `DELETE FROM capacitylens_federated_link_ceremonies
          WHERE expiresAt <= ?
             OR EXISTS (
                  SELECT 1
                    FROM capacitylens_federated_link_observations AS observation
                   WHERE observation.principalId = capacitylens_federated_link_ceremonies.principalId
                     AND observation.providerId = capacitylens_federated_link_ceremonies.providerId
                )`,
      ).run(now);
    },
    "immediate",
  );
}
