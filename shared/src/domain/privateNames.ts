import type { AppData, Client, Project } from "../types/entities";

const PRIVATE_CODE_NAME_FALLBACK_TAG = "0000";

/** Stable, non-secret cover name used only when repairing malformed private data. Imported records
 * have already received their final remapped id, so the tag distinguishes rows without using the
 * private name. */
export function privateCodeNameFallback(id: unknown): string {
  const tag = typeof id === "string" ? id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) : "";
  return `Confidential #${tag || PRIVATE_CODE_NAME_FALLBACK_TAG}`;
}

/** Strip quotation marks a user may have typed around a code name. Quotes are display chrome, not data. */
export function normalizeCodeName(value: string): string {
  return value
    .trim()
    .replace(/^["“”]+|["“”]+$/gu, "")
    .trim();
}

/** Code names always render inside straight double quotation marks. */
export function quoteCodeName(value: string, id?: unknown): string {
  return `"${normalizeCodeName(value) || privateCodeNameFallback(id)}"`;
}

/** Ordinary writes must supply a real code name when they make a client/project private. */
export function hasUsablePrivateCodeName(entity: Record<string, unknown>): boolean {
  return (
    entity.isPrivate !== true || (typeof entity.codeName === "string" && normalizeCodeName(entity.codeName).length > 0)
  );
}

/** Name value to pass into copy that already supplies its own surrounding quotation marks. Private
 * read projections already carry quotes, so remove only those outer marks to prevent `""Code""`. */
export function nameForQuotedContext(value: string): string {
  return normalizeCodeName(value);
}

type PrivateNamedEntity = Client | Project;

/**
 * Replace one private entity's real name with its quoted code name and remove the redundant raw
 * `codeName` field. Public rows are returned unchanged. This is the server's field-level read
 * projection and is also used for write/conflict echoes, so no non-owner response path can drift.
 */
export function redactPrivateName<T extends PrivateNamedEntity>(entity: T): T {
  if (!entity.isPrivate) return entity;
  if (entity.codeName === undefined && /^".*"$/u.test(entity.name)) return entity;
  const codeName = typeof entity.codeName === "string" ? entity.codeName : "";
  const redacted = { ...entity, name: quoteCodeName(codeName, entity.id) };
  delete redacted.codeName;
  return redacted;
}

/** Redact private client/project real names throughout one already-tenant-scoped AppData slice. */
export function redactPrivateNames(data: AppData): AppData {
  return {
    ...data,
    clients: data.clients.map(redactPrivateName),
    projects: data.projects.map(redactPrivateName),
  };
}
