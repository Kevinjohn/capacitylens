import { createHash } from "node:crypto";

export function buildErrorRedirect({
  browserAuthErrorUrl,
  trustedLinkOrigins,
  readVerificationValues,
}: {
  browserAuthErrorUrl: URL;
  trustedLinkOrigins: ReadonlySet<string>;
  /** Identity storage stays owned by auth.ts: returns the stored verification values for one
   *  identifier, or null while the verification table does not exist yet. */
  readVerificationValues: (storedIdentifier: string) => readonly string[] | null;
}): (request: Request) => URL {
  const callbackErrorUrl = (request: Request): URL => {
    const fallback = new URL(browserAuthErrorUrl);
    const state = new URL(request.url).searchParams.get("state");
    if (!state) return fallback;
    // Better Auth stores the returned OAuth state as the verification identifier. Use that indexed
    // coordinate instead of parsing every reset, MFA, and abandoned OAuth row on each callback.
    const storedIdentifier = createHash("sha256").update(state).digest("base64url");
    const values = readVerificationValues(storedIdentifier);
    if (values === null) return fallback;
    for (const value of values) {
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
