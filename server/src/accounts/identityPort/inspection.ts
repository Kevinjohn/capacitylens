import type { PrincipalSummary } from "@capacitylens/shared/account/types";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityFacts, SsoCutoverIdentityPort } from "./contracts";
import { timestampMs } from "./instants";
import { providerFailure } from "./vendorErrors";

export function createInspection(
  context: Pick<
    IdentityPortContext,
    "input" | "accountTableExists" | "verificationTableExists" | "federatedLinkObservationsTableExists"
  >,
): Pick<SsoCutoverIdentityPort, "inspectProviderLinks" | "inspectSsoCutover" | "getPrincipalSummaries"> {
  const { input, accountTableExists, verificationTableExists, federatedLinkObservationsTableExists } = context;
  const { db } = input;

  return {
    inspectProviderLinks(principalId, providerId) {
      if (!accountTableExists(db)) return [];
      const hasObservations = federatedLinkObservationsTableExists(db);
      const rows = hasObservations
        ? (db
            .prepare(
              `SELECT account.id AS rowId,
                      account.accountId AS subject,
                      CASE
                        WHEN observation.accountRowId IS NOT NULL
                         AND observation.principalId = account.userId
                         AND observation.providerId = account.providerId
                         AND observation.subject = account.accountId
                        THEN 1 ELSE 0
                      END AS verified
                 FROM account
                 LEFT JOIN capacitylens_federated_link_observations AS observation
                   ON observation.accountRowId = account.id
                WHERE account.userId = ? AND account.providerId = ?
                ORDER BY account.id
                LIMIT 2`,
            )
            .all(principalId, providerId) as Array<{ rowId: string; subject: string; verified: number }>)
        : (db
            .prepare(
              `SELECT id AS rowId, accountId AS subject, 0 AS verified
                 FROM account
                WHERE userId = ? AND providerId = ?
                ORDER BY id
                LIMIT 2`,
            )
            .all(principalId, providerId) as Array<{ rowId: string; subject: string; verified: number }>);
      return rows.map((link) => ({ ...link, verified: link.verified === 1 }));
    },
    inspectSsoCutover(providerId): SsoCutoverIdentityFacts {
      const users = db.prepare(`SELECT id, email, name FROM user ORDER BY email, id`).all() as Array<{
        id: string;
        email: string;
        name: string | null;
      }>;
      const providerRows = db
        .prepare(`SELECT id, userId, providerId, accountId FROM account ORDER BY userId, providerId, accountId`)
        .all() as Array<{ id: string; userId: string; providerId: string; accountId: string }>;
      const observations = new Map(
        federatedLinkObservationsTableExists(db)
          ? (
              db
                .prepare(
                  `SELECT accountRowId, principalId, providerId, subject
                     FROM capacitylens_federated_link_observations`,
                )
                .all() as Array<{
                accountRowId: string;
                principalId: string;
                providerId: string;
                subject: string;
              }>
            ).map((observation) => [observation.accountRowId, observation] as const)
          : [],
      );
      const providersByPrincipal = new Map<string, string[]>();
      for (const row of providerRows) {
        const values = providersByPrincipal.get(row.userId) ?? [];
        values.push(row.providerId);
        providersByPrincipal.set(row.userId, values);
      }
      const principalIds = new Set(users.map(({ id }) => id));
      const outstandingResetPrincipalIds = verificationTableExists(db)
        ? [
            ...new Set(
              (
                db.prepare(`SELECT value, expiresAt FROM verification`).all() as Array<{
                  value: string;
                  expiresAt: string | number;
                }>
              )
                .filter(({ expiresAt }) => {
                  const expiry = timestampMs(expiresAt);
                  return !Number.isFinite(expiry) || expiry > Date.now();
                })
                .map(({ value }) => value)
                .filter((value) => principalIds.has(value)),
            ),
          ]
        : [];
      return {
        principals: users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.name,
          providerIds: [...new Set(providersByPrincipal.get(user.id) ?? [])],
        })),
        requiredProviderLinks: providerRows
          .filter((row) => row.providerId === providerId)
          .map((row) => ({
            rowId: row.id,
            principalId: row.userId,
            subject: row.accountId,
            verified:
              observations.get(row.id)?.principalId === row.userId &&
              observations.get(row.id)?.providerId === row.providerId &&
              observations.get(row.id)?.subject === row.accountId,
          })),
        alternativeProviderLinks: providerRows
          .filter((row) => row.providerId !== providerId && row.providerId !== "credential")
          .map((row) => ({
            rowId: row.id,
            principalId: row.userId,
            providerId: row.providerId,
            subject: row.accountId,
          })),
        outstandingResetPrincipalIds,
      };
    },
    async getPrincipalSummaries({ principalIds }): Promise<readonly PrincipalSummary[]> {
      if (principalIds.length === 0) return [];
      try {
        const unique = [...new Set(principalIds)];
        const summaries: PrincipalSummary[] = [];
        for (let offset = 0; offset < unique.length; offset += 500) {
          const chunk = unique.slice(offset, offset + 500);
          const placeholders = chunk.map(() => "?").join(", ");
          summaries.push(
            ...db
              .prepare(
                `SELECT id, name, email
                   FROM user
                  WHERE id IN (${placeholders})`,
              )
              .all(...chunk)
              .map((row) => {
                const value = row as {
                  id: string;
                  name: string | null;
                  email: string | null;
                };
                return {
                  id: value.id,
                  displayName: value.name,
                  email: value.email,
                };
              }),
          );
        }
        return summaries;
      } catch (error) {
        throw providerFailure("Identity summaries are temporarily unavailable.", error);
      }
    },
  };
}
