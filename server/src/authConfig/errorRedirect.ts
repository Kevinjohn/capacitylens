import { createHash } from "node:crypto";
import type { Db } from "../db";

export function buildErrorRedirect({
  db,
  browserAuthErrorUrl,
  trustedLinkOrigins,
  sqliteTableExists,
}: {
  db: Db;
  browserAuthErrorUrl: URL;
  trustedLinkOrigins: ReadonlySet<string>;
  sqliteTableExists: (db: Db, table: string) => boolean;
}): (request: Request) => URL {
  const callbackErrorUrl = (request: Request): URL => {
    const fallback = new URL(browserAuthErrorUrl);
    if (!sqliteTableExists(db, "verification")) return fallback;
    const state = new URL(request.url).searchParams.get("state");
    if (!state) return fallback;
    // Better Auth stores the returned OAuth state as the verification identifier. Use that indexed
    // coordinate instead of parsing every reset, MFA, and abandoned OAuth row on each callback.
    const storedIdentifier = createHash("sha256").update(state).digest("base64url");
    const rows = db
      .prepare(`SELECT value FROM verification WHERE identifier = ? LIMIT 2`)
      .all(storedIdentifier) as Array<{
      value: string;
    }>;
    for (const { value } of rows) {
      try {
        const stored = JSON.parse(value) as { oauthState?: unknown; errorURL?: unknown };
        if (stored.oauthState !== state || typeof stored.errorURL !== "string") continue;
        const target = new URL(stored.errorURL);
        if (trustedLinkOrigins.has(target.origin) && !target.username && !target.password) return target;
      } catch {
        // Verification values are shared with non-OAuth ceremonies. Non-JSON rows cannot carry a
        // validated callback URL and deliberately fall through to the stable application target.
      }
    }
    return fallback;
  };

  return callbackErrorUrl;
}
