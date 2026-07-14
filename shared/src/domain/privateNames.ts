import type { AppData, Client, Project } from '../types/entities'

/** Fail-closed cover name used only when sanitising malformed private data with no usable code name. */
export const PRIVATE_CODE_NAME_FALLBACK = 'Confidential'

/** Strip quotation marks a user may have typed around a code name. Quotes are display chrome, not data. */
export function normalizeCodeName(value: string): string {
  return value.trim().replace(/^["“”]+|["“”]+$/gu, '').trim()
}

/** Code names always render inside straight double quotation marks. */
export function quoteCodeName(value: string): string {
  return `"${normalizeCodeName(value) || PRIVATE_CODE_NAME_FALLBACK}"`
}

/** Name value to pass into copy that already supplies its own surrounding quotation marks. Private
 * read projections already carry quotes, so remove only those outer marks to prevent `""Code""`. */
export function nameForQuotedContext(value: string): string {
  return normalizeCodeName(value)
}

type PrivateNamedEntity = Client | Project

/**
 * Replace one private entity's real name with its quoted code name and remove the redundant raw
 * `codeName` field. Public rows are returned unchanged. This is the server's field-level read
 * projection and is also used for write/conflict echoes, so no non-owner response path can drift.
 */
export function redactPrivateName<T extends PrivateNamedEntity>(entity: T): T {
  if (entity.isPrivate !== true) return entity
  const redacted = { ...entity, name: quoteCodeName(entity.codeName ?? '') }
  delete redacted.codeName
  return redacted
}

/** Redact private client/project real names throughout one already-tenant-scoped AppData slice. */
export function redactPrivateNames(data: AppData): AppData {
  return {
    ...data,
    clients: data.clients.map(redactPrivateName),
    projects: data.projects.map(redactPrivateName),
  }
}
