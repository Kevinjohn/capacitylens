import { expect, type APIRequestContext } from "@playwright/test";
import { serverTestApiOrigin } from "../scripts/playwrightRunMode.mjs";

// Helpers for the DB-backed E2E project. State lives on the SQLite server (not
// browser memory), so isolation comes from resetting the server over its API between
// tests. The app itself is driven through the same real UI flows the demo specs use
// (see ./browserTestSupport openApp), so these tests exercise the FULL stack:
// UI → store → ServerSyncAdapter → REST → SQLite, and rehydration via GET /api/state.

// Ordinary tests own a lane API; rehearsal explicitly selects its disposable same-origin stack.
export const API = serverTestApiOrigin();

/** Wipe the server DB and re-seed the demo data so each test starts identically. */
export async function resetServer(request: APIRequestContext, withSeed = true): Promise<void> {
  const res = await request.post(`${API}/api/test/reset`, { data: { seed: withSeed } });
  expect(res.ok()).toBeTruthy();
}

/** The whole server state, for assertions that bypass the UI. Rows expose the lifecycle tombstone
 *  fields (archivedAt/deletedAt) too, so a test can prove an archive RETAINED the row rather than
 *  hard-deleting it (P2.5b). */
export async function serverState(request: APIRequestContext): Promise<
  Record<
    string,
    Array<{
      id: string;
      name?: string;
      archivedAt?: string;
      deletedAt?: string;
      language?: string;
      seriesId?: string;
      engagement?: "studio" | "supplementary";
      halfDays?: number[];
      avatarUrl?: string;
    }>
  >
> {
  const res = await request.get(`${API}/api/state`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export function requireStateRows<T extends Awaited<ReturnType<typeof serverState>>>(
  state: T,
  table: keyof T,
): T[keyof T] {
  const rows = state[table];
  if (rows === undefined) throw new Error(`Server state must include the ${String(table)} table`);
  return rows;
}
