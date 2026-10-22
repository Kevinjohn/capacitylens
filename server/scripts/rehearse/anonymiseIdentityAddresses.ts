import type { DatabaseSync } from "node:sqlite";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import { hasTable, readColumnNames } from "./sqliteIntrospection";

function canonicalAddress(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalDomainForAddress(value: string): string | null {
  const normalized = canonicalAddress(value);
  const separator = normalized.lastIndexOf("@");
  return separator < 0 ? null : parseApprovedDomain(normalized.slice(separator + 1));
}

function uniqueUserAliasFor(addressAliases: ReadonlyMap<string, string>): (value: string) => string | null {
  const usedVariants = new Map<string, number>();
  return (value) => {
    const normalized = canonicalAddress(value);
    const base = addressAliases.get(normalized);
    if (!base) return null;
    let variant = usedVariants.get(normalized) ?? 0;
    usedVariants.set(normalized, variant + 1);
    const result = [...base]
      .map((character) => {
        if (!/[a-z]/.test(character)) return character;
        const upper = variant % 2 === 1;
        variant = Math.floor(variant / 2);
        return upper ? character.toUpperCase() : character;
      })
      .join("");
    if (variant !== 0) throw new Error("Too many equivalent rehearsal email addresses.");
    return result;
  };
}

interface IdentityAddressRows {
  restrictions: Array<{ rowId: number; verifiedEmail: string }>;
  proofs: Array<{ rowId: number; email: string }>;
  users: Array<{ rowId: number; email: string }>;
  invitations: Array<{ rowId: number; preauthEmail: string }>;
  policies: Array<{ rowId: number; approvedDomains: string }>;
}

function readIdentityAddressRows(db: DatabaseSync): IdentityAddressRows {
  return {
    restrictions: hasTable(db, "account_access_restrictions")
      ? (db
          .prepare(
            `SELECT rowid AS rowId, verifiedEmail FROM account_access_restrictions
        WHERE verifiedEmail IS NOT NULL ORDER BY rowid`,
          )
          .all() as Array<{ rowId: number; verifiedEmail: string }>)
      : [],
    proofs: hasTable(db, "identity_email_proofs")
      ? (db.prepare(`SELECT rowid AS rowId, email FROM identity_email_proofs ORDER BY rowid`).all() as Array<{
          rowId: number;
          email: string;
        }>)
      : [],
    users:
      hasTable(db, "user") && readColumnNames(db, "user").has("email")
        ? (db.prepare("SELECT rowid AS rowId, email FROM user").all() as Array<{ rowId: number; email: string }>)
        : [],
    invitations:
      hasTable(db, "invites") && readColumnNames(db, "invites").has("preauthEmail")
        ? (db
            .prepare("SELECT rowid AS rowId, preauthEmail FROM invites WHERE preauthEmail IS NOT NULL ORDER BY rowid")
            .all() as Array<{ rowId: number; preauthEmail: string }>)
        : [],
    policies:
      hasTable(db, "account_joining_policies") && readColumnNames(db, "account_joining_policies").has("approvedDomains")
        ? (db
            .prepare("SELECT rowid AS rowId, approvedDomains FROM account_joining_policies ORDER BY rowid")
            .all() as Array<{
            rowId: number;
            approvedDomains: string;
          }>)
        : [],
  };
}

function parseSourceApprovedDomains(policies: IdentityAddressRows["policies"]): string[] {
  return policies.flatMap(({ approvedDomains: value }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      // No cause: the parser's message quotes the source text, and rehearsal never prints tenant content.
      throw new Error("Invalid approved domain list in rehearsal source.");
    }
    if (!Array.isArray(parsed)) throw new Error("Invalid approved domain list in rehearsal source.");
    return parsed.flatMap((candidate) => {
      const domain = parseApprovedDomain(candidate);
      if (domain === null) throw new Error("Invalid approved domain in rehearsal source.");
      return [domain];
    });
  });
}

function buildDomainAliases(emails: readonly string[], approvedDomains: readonly string[]): Map<string, string> {
  const domains = new Set(approvedDomains);
  for (const email of emails) {
    const domain = canonicalDomainForAddress(email);
    if (domain !== null) domains.add(domain);
  }
  return new Map([...domains].sort().map((domain, index) => [domain, `rehearsal-domain-${index + 1}.example.invalid`]));
}

function buildAddressAliases(
  emails: readonly string[],
  domainAliases: ReadonlyMap<string, string>,
): Map<string, string> {
  const addressAliases = new Map<string, string>();
  for (const [index, value] of emails.entries()) {
    const normalized = canonicalAddress(value);
    if (!addressAliases.has(normalized)) {
      const domain = canonicalDomainForAddress(normalized);
      const domainAlias = domain === null ? "example.invalid" : domainAliases.get(domain);
      if (!domainAlias) throw new Error("Missing rehearsal email domain alias.");
      addressAliases.set(normalized, `rehearsal-proof-${index + 1}@${domainAlias}`);
    }
  }
  return addressAliases;
}

function updateEmailRows(
  db: DatabaseSync,
  rows: IdentityAddressRows,
  addressAliases: ReadonlyMap<string, string>,
): void {
  const alias = (value: string): string => {
    const mapped = addressAliases.get(canonicalAddress(value));
    if (!mapped) throw new Error("Missing rehearsal email alias.");
    return mapped;
  };
  const uniqueUserAlias = uniqueUserAliasFor(addressAliases);
  if (rows.users.length > 0) {
    const updateUser = db.prepare("UPDATE user SET email = ? WHERE rowid = ?");
    for (const user of rows.users) {
      const address = uniqueUserAlias(user.email);
      updateUser.run(address ?? `rehearsal-user-${user.rowId}@example.invalid`, user.rowId);
    }
  }
  if (rows.restrictions.length > 0) {
    const updateRestriction = db.prepare("UPDATE account_access_restrictions SET verifiedEmail = ? WHERE rowid = ?");
    for (const restriction of rows.restrictions) {
      updateRestriction.run(alias(restriction.verifiedEmail), restriction.rowId);
    }
  }
  if (rows.proofs.length > 0) {
    const updateProof = db.prepare("UPDATE identity_email_proofs SET email = ? WHERE rowid = ?");
    for (const proof of rows.proofs) updateProof.run(alias(proof.email), proof.rowId);
  }
  if (rows.invitations.length > 0) {
    const updateInvitation = db.prepare("UPDATE invites SET preauthEmail = ? WHERE rowid = ?");
    for (const invitation of rows.invitations) updateInvitation.run(alias(invitation.preauthEmail), invitation.rowId);
  }
}

function updateApprovedDomainRows(
  db: DatabaseSync,
  policies: IdentityAddressRows["policies"],
  domainAliases: ReadonlyMap<string, string>,
): void {
  if (policies.length > 0) {
    const updatePolicy = db.prepare("UPDATE account_joining_policies SET approvedDomains = ? WHERE rowid = ?");
    for (const policy of policies) {
      const parsed = JSON.parse(policy.approvedDomains) as unknown[];
      const mapped = parsed.map((candidate) => {
        const domain = parseApprovedDomain(candidate);
        const replacement = domain === null ? null : domainAliases.get(domain);
        if (!replacement) throw new Error("Missing rehearsal approved domain alias.");
        return replacement;
      });
      updatePolicy.run(JSON.stringify([...new Set(mapped)].sort()), policy.rowId);
    }
  }
}

// One pass shares aliases across restrictions, recreated identities, invitations, and proof rows.
// Domain aliases keep approved-domain admission equivalent in the rehearsal.
/** Preserves address equality and approved-domain admission while replacing identity coordinates. */
export function anonymiseIdentityAddresses(db: DatabaseSync): void {
  const rows = readIdentityAddressRows(db);
  const emails = [
    ...rows.restrictions.map((row) => row.verifiedEmail),
    ...rows.proofs.map((row) => row.email),
    ...rows.users.map((row) => row.email),
    ...rows.invitations.map((row) => row.preauthEmail),
  ];
  const domainAliases = buildDomainAliases(emails, parseSourceApprovedDomains(rows.policies));
  updateEmailRows(db, rows, buildAddressAliases(emails, domainAliases));
  updateApprovedDomainRows(db, rows.policies, domainAliases);
}
