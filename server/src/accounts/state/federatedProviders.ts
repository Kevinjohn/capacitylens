import type { Db } from "../../db";

export function bindFederatedProvider(db: Db, applicationId: string, issuer: string, providerId: string): void {
  const byIssuer = db
    .prepare(
      `
    SELECT providerId FROM account_federated_provider_bindings
     WHERE applicationId = ? AND issuer = ?
  `,
    )
    .get(applicationId, issuer) as { providerId: string } | undefined;
  if (byIssuer && byIssuer.providerId !== providerId) {
    throw new Error(
      `OIDC provider id is immutable for issuer ${issuer}; expected ${byIssuer.providerId}, received ${providerId}.`,
    );
  }
  const byProvider = db
    .prepare(
      `
    SELECT issuer FROM account_federated_provider_bindings
     WHERE applicationId = ? AND providerId = ?
  `,
    )
    .get(applicationId, providerId) as { issuer: string } | undefined;
  if (byProvider && byProvider.issuer !== issuer) {
    throw new Error(`OIDC provider id ${providerId} is already bound to issuer ${byProvider.issuer}.`);
  }
  db.prepare(
    `
    INSERT OR IGNORE INTO account_federated_provider_bindings
      (applicationId, issuer, providerId, createdAt)
    VALUES (?, ?, ?, ?)
  `,
  ).run(applicationId, issuer, providerId, new Date().toISOString());
}

export function providerIdForIssuer(db: Db, applicationId: string, issuer: string): string | null {
  const row = db
    .prepare(
      `
    SELECT providerId FROM account_federated_provider_bindings
     WHERE applicationId = ? AND issuer = ?
  `,
    )
    .get(applicationId, issuer) as { providerId: string } | undefined;
  return row?.providerId ?? null;
}
