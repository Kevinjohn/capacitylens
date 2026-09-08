import type { PrincipalSummary } from "@capacitylens/shared/account/types";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityFacts, SsoCutoverIdentityPort } from "./contracts";
import { parseTimestampMilliseconds } from "./instants";
import { createProviderFailure } from "./vendorErrors";

type InspectionContext = Pick<
  IdentityPortContext,
  "input" | "accountTableExists" | "verificationTableExists" | "federatedLinkObservationsTableExists"
>;
type ProviderRow = { id: string; userId: string; providerId: string; accountId: string };
type ObservationRow = { accountRowId: string; principalId: string; providerId: string; subject: string };

function readProviderLinks(context: InspectionContext, principalId: string, providerId: string) {
  const { db } = context.input;
  if (!context.accountTableExists(db)) return [];
  const select = context.federatedLinkObservationsTableExists(db)
    ? `SELECT account.id AS rowId, account.accountId AS subject,
              CASE WHEN observation.accountRowId IS NOT NULL
                     AND observation.principalId = account.userId
                     AND observation.providerId = account.providerId
                     AND observation.subject = account.accountId THEN 1 ELSE 0 END AS verified
         FROM account LEFT JOIN capacitylens_federated_link_observations AS observation
           ON observation.accountRowId = account.id
        WHERE account.userId = ? AND account.providerId = ? ORDER BY account.id LIMIT 2`
    : `SELECT id AS rowId, accountId AS subject, 0 AS verified
         FROM account WHERE userId = ? AND providerId = ? ORDER BY id LIMIT 2`;
  const rows = db.prepare(select).all(principalId, providerId) as Array<{
    rowId: string;
    subject: string;
    verified: number;
  }>;
  return rows.map((link) => ({ ...link, verified: link.verified === 1 }));
}

function readObservations(context: InspectionContext): Map<string, ObservationRow> {
  const { db } = context.input;
  if (!context.federatedLinkObservationsTableExists(db)) return new Map();
  const rows = db
    .prepare(`SELECT accountRowId, principalId, providerId, subject FROM capacitylens_federated_link_observations`)
    .all() as ObservationRow[];
  return new Map(rows.map((observation) => [observation.accountRowId, observation]));
}

function readOutstandingResetPrincipalIds(context: InspectionContext, principalIds: Set<string>): string[] {
  const { db } = context.input;
  if (!context.verificationTableExists(db)) return [];
  const rows = db.prepare(`SELECT value, expiresAt FROM verification`).all() as Array<{
    value: string;
    expiresAt: string | number;
  }>;
  return [
    ...new Set(
      rows
        .filter(({ expiresAt }) => {
          const expiry = parseTimestampMilliseconds(expiresAt);
          return expiry === null || expiry > Date.now();
        })
        .map(({ value }) => value)
        .filter((value) => principalIds.has(value)),
    ),
  ];
}

function inspectSsoCutover(context: InspectionContext, providerId: string): SsoCutoverIdentityFacts {
  const { db } = context.input;
  const users = db.prepare(`SELECT id, email, name FROM user ORDER BY email, id`).all() as Array<{
    id: string;
    email: string;
    name: string | null;
  }>;
  const providerRows = db
    .prepare(`SELECT id, userId, providerId, accountId FROM account ORDER BY userId, providerId, accountId`)
    .all() as ProviderRow[];
  const observations = readObservations(context);
  const providersByPrincipal = new Map<string, string[]>();
  for (const row of providerRows) {
    const values = providersByPrincipal.get(row.userId) ?? [];
    values.push(row.providerId);
    providersByPrincipal.set(row.userId, values);
  }
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
      .map((row) => ({ rowId: row.id, principalId: row.userId, providerId: row.providerId, subject: row.accountId })),
    outstandingResetPrincipalIds: readOutstandingResetPrincipalIds(context, new Set(users.map(({ id }) => id))),
  };
}

async function getPrincipalSummaries(
  context: InspectionContext,
  principalIds: readonly string[],
): Promise<readonly PrincipalSummary[]> {
  if (principalIds.length === 0) return [];
  try {
    const unique = [...new Set(principalIds)];
    const summaries: PrincipalSummary[] = [];
    for (let offset = 0; offset < unique.length; offset += 500) {
      const chunk = unique.slice(offset, offset + 500);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = context.input.db
        .prepare(`SELECT id, name, email FROM user WHERE id IN (${placeholders})`)
        .all(...chunk) as Array<{ id: string; name: string | null; email: string | null }>;
      summaries.push(...rows.map(({ id, name, email }) => ({ id, displayName: name, email })));
    }
    return summaries;
  } catch (error) {
    throw createProviderFailure("Identity summaries are temporarily unavailable.", error);
  }
}

export function createInspection(
  context: InspectionContext,
): Pick<SsoCutoverIdentityPort, "inspectProviderLinks" | "inspectSsoCutover" | "getPrincipalSummaries"> {
  return {
    inspectProviderLinks(principalId, providerId) {
      return readProviderLinks(context, principalId, providerId);
    },
    inspectSsoCutover(providerId) {
      return inspectSsoCutover(context, providerId);
    },
    getPrincipalSummaries({ principalIds }) {
      return getPrincipalSummaries(context, principalIds);
    },
  };
}
