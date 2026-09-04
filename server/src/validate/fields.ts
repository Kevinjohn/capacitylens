import { TABLES } from "../tables";
// TABLES is static for the process lifetime, so the accepted-column Set per table is built once
// and memoized here rather than rebuilt from spec.columns on every write (sanitizeWrite alone
// calls acceptedWriteFields twice per write, via acceptedFieldNames and directly).
const acceptedColumnsByTable = new Map<string, Set<string>>();

/** Copy only columns accepted by the table codec. Generic request bodies are untrusted; keeping
 * extra properties would leak them into audit metadata and response echoes even though SQLite
 * silently ignores them. */
export function acceptedWriteFields(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const spec = TABLES[table];
  if (!spec) return {};
  let accepted = acceptedColumnsByTable.get(table);
  if (!accepted) {
    accepted = new Set(spec.columns.map((column) => column.name));
    acceptedColumnsByTable.set(table, accepted);
  }
  return Object.fromEntries(Object.entries(row).filter(([key]) => accepted.has(key)));
}

export function acceptedFieldNames(table: string, row: unknown): string[] {
  return row && typeof row === "object" ? Object.keys(acceptedWriteFields(table, row as Record<string, unknown>)) : [];
}

/** Field names the caller requested AND the write funnel actually changed. This keeps audit
 * metadata value-free while excluding rejected, pinned and normalized-to-existing input. */
export function appliedRequestedFieldNames(
  table: string,
  requested: unknown,
  existing: Record<string, unknown> | undefined,
  applied: Record<string, unknown>,
): string[] {
  if (!requested || typeof requested !== "object") return [];
  return acceptedFieldNames(table, requested).filter(
    (field) =>
      Object.hasOwn(applied, field) &&
      (existing === undefined || JSON.stringify(existing[field]) !== JSON.stringify(applied[field])),
  );
}
