import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { ports } from "../scripts/ports.mjs";
import { serverTestApiOrigin } from "../scripts/playwrightRunMode.mjs";
import { resetDbE2EProductData } from "./dbAuthenticationSupport.ts";

// Database-backed specs reset server state between tests, then exercise the app through
// real UI flows. Their normal app fixture contains one company; server tests seed legacy
// multi-company data directly when they need tenant-isolation cases.

/** Resolves the server API origin for the claimed local lane. */
export const API = serverTestApiOrigin(ports().dbApi);

type ResetServerOptions = { request: APIRequestContext; withSeed?: boolean };
/** Wipes the server data and optionally restores one supported-company fixture. */
export async function resetServer({ request, withSeed = true }: ResetServerOptions): Promise<void> {
  const identity = await request.get(`${API}/api/auth/me`);
  expect(identity.ok(), "DB-backed setup requires the real seeded administrator session").toBeTruthy();
  resetDbE2EProductData(withSeed);
}

/** Returns the server tables used by database-backed assertions. */
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

/** Returns the named table’s rows without changing the server state.
 * @throws Error when the response omits the table; callers must not treat an omitted table as empty.
 */
export function requireStateRows<T extends Awaited<ReturnType<typeof serverState>>>(
  state: T,
  table: keyof T,
): T[keyof T] {
  const rows = state[table];
  if (rows === undefined) throw new Error(`Server state must include the ${String(table)} table`);
  return rows;
}
