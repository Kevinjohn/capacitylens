import { expect, type APIRequestContext } from '@playwright/test'

// Helpers for the DB-backed E2E project. State lives on the SQLite server (not
// localStorage), so isolation comes from resetting the server over its API between
// tests. The app itself is driven through the same real UI flows the localStorage
// specs use (see ./helpers openApp), so these tests exercise the FULL stack:
// UI → store → ServerSyncAdapter → REST → SQLite, and rehydration via GET /api/state.

// The server origin the db-backed Vite build points at (see playwright.config.ts).
const API = process.env.VITE_CAPACITYLENS_API ?? 'http://localhost:8787'

/** Wipe the server DB and re-seed the demo data so each test starts identically. */
export async function resetServer(request: APIRequestContext, withSeed = true): Promise<void> {
  const res = await request.post(`${API}/api/test/reset`, { data: { seed: withSeed } })
  expect(res.ok()).toBeTruthy()
}

/** The whole server state, for assertions that bypass the UI. Rows expose the lifecycle tombstone
 *  fields (archivedAt/deletedAt) too, so a test can prove an archive RETAINED the row rather than
 *  hard-deleting it (P2.5b). */
export async function serverState(
  request: APIRequestContext,
): Promise<Record<string, { id: string; name?: string; archivedAt?: string; deletedAt?: string }[]>> {
  const res = await request.get(`${API}/api/state`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}
