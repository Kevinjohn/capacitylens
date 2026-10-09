import { createHash } from "node:crypto";

export function createErrorRedirect({
  browserAuthErrorUrl,
  trustedLinkOrigins,
  readVerificationValues,
}: {
  browserAuthErrorUrl: URL;
  trustedLinkOrigins: ReadonlySet<string>;
  /** Identity storage stays owned by auth.ts: returns the stored verification values for one
   * identifier, or null while the verification table does not exist yet. */
  readVerificationValues: (storedIdentifier: string) => readonly string[] | null;
}): (request: Request) => URL {
  const resolveCallbackErrorUrl = (request: Request): URL => {
    const fallback = new URL(browserAuthErrorUrl);
    const state = new URL(request.url).searchParams.get("state");
    if (!state) return fallback;
    // Better Auth namespaces database-backed OAuth state before hashing its verification identifier.
    // Match that key to resolve only this callback instead of scanning unrelated verification rows.
    const storedIdentifier = createHash("sha256").update(`auth-state:${state}`).digest("base64url");
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

  return resolveCallbackErrorUrl;
}
