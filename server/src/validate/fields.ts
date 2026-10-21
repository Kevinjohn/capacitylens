import { TABLES } from "../tables";
// Memoize accepted columns because table specifications are immutable for the process lifetime.
const acceptedColumnsByTable = new Map<string, Set<string>>();

/** Copy only columns accepted by the table codec. Generic request bodies are untrusted; keeping
 * extra properties would leak them into audit metadata and response echoes even though SQLite
 * silently ignores them. */
export function buildAcceptedWriteFields(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const spec = TABLES[table];
  if (!spec) return {};
  let accepted = acceptedColumnsByTable.get(table);
  if (!accepted) {
    accepted = new Set(spec.columns.map((column) => column.name));
    acceptedColumnsByTable.set(table, accepted);
  }
  return Object.fromEntries(Object.entries(row).filter(([key]) => accepted.has(key)));
}

/**
 * Returns the names of fields accepted by the table write specification.
 */
export function listAcceptedFieldNames(table: string, row: unknown): string[] {
  return row && typeof row === "object"
    ? Object.keys(buildAcceptedWriteFields(table, row as Record<string, unknown>))
    : [];
}

interface ListAppliedRequestedFieldNamesInput {
  table: string;
  requested: unknown;
  existing: Record<string, unknown> | undefined;
  applied: Record<string, unknown>;
}

/** Field names the caller requested and the write funnel actually changed. This keeps audit
 * metadata value-free while excluding rejected, pinned and normalized-to-existing input. */
export function listAppliedRequestedFieldNames({
  table,
  requested,
  existing,
  applied,
}: ListAppliedRequestedFieldNamesInput): string[] {
  if (!requested || typeof requested !== "object") return [];
  return listAcceptedFieldNames(table, requested).filter(
    (field) =>
      Object.hasOwn(applied, field) &&
      (existing === undefined || JSON.stringify(existing[field]) !== JSON.stringify(applied[field])),
  );
}
