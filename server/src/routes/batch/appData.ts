import { APP_DATA_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import { TABLES } from "../../tables";

/** Append one complete account slice to a request-local validation projection. */
export function appendAppDataSlice(target: AppData, slice: AppData): void {
  for (const key of APP_DATA_KEYS) {
    const targetRows = target[key] as unknown[];
    targetRows.push(...slice[key]);
  }
}

/** A client may echo the deterministic Internal row immediately after creating its account in the
 * same batch. Accept that protected duplicate only when every stored client field is already the
 * exact server-generated value. Persistence timestamps are server-owned, so compare them after
 * pinning the no-op candidate to the generated revision returned in the receipt. */
export function matchesMintedInternalClient(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  const normalized: Record<string, unknown> = {
    ...incoming,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };
  return TABLES.clients.columns.every(({ name }) => normalized[name] === existing[name]);
}
