import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export function newJoiningSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newJoiningIntentId(): string {
  return randomUUID();
}

export function hashJoiningSourceIp(secret: string, sourceIp: string): string {
  return createHmac("sha256", secret).update("company-join-ip\0").update(sourceIp).digest("hex");
}

export function hashJoiningValue(kind: string, value: string): string {
  return createHash("sha256").update(`company-join-${kind}\0`).update(value).digest("hex");
}

export function joiningCookieNames(applicationId: string, secure: boolean) {
  const prefix = `${secure ? "__Host-" : ""}${applicationId}-join`;
  return { browser: `${prefix}-browser`, intent: `${prefix}-intent` };
}

export function readJoiningCookie(headers: Headers, name: string): string | null {
  const prefix = `${name}=`;
  for (const entry of (headers.get("cookie") ?? "").split(";")) {
    const value = entry.trim();
    if (value.startsWith(prefix)) {
      const secret = value.slice(prefix.length);
      return SECRET_RE.test(secret) ? secret : null;
    }
  }
  return null;
}

export function joiningCookie(input: { name: string; value: string; secure: boolean; maxAge: number }): string {
  const { name, value, secure, maxAge } = input;
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function joiningEmailHint(email: string): string {
  return `${email.slice(0, 1)}***${email.slice(email.indexOf("@"))}`;
}

/** Sign current-address proof with a domain-separated HMAC; expiry is epoch milliseconds. */
export function mintJoinEmailProofToken(
  secret: string,
  input: { principalId: string; email: string; expiresAt: number },
): string {
  const payload = Buffer.from(JSON.stringify({ p: input.principalId, e: input.email, x: input.expiresAt })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update("join-email-proof\0" + payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/** Return verified claims, or null so the route can surface invalid or expired proof. */
export function verifyJoinEmailProofToken(
  secret: string,
  token: string,
  now: number,
): { principalId: string; email: string } | null {
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !SECRET_RE.test(signature))
    return null;
  const expected = createHmac("sha256", secret)
    .update("join-email-proof\0" + payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return parseJoinEmailProofClaims(payload, now);
}

function parseJoinEmailProofClaims(payload: string, now: number): { principalId: string; email: string } | null {
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    // Malformed credentials are surfaced by the caller as invalid proof.
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  const { p, e, x } = claims as Record<string, unknown>;
  if (
    typeof p !== "string" ||
    !p ||
    typeof e !== "string" ||
    !e ||
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x <= now
  )
    return null;
  return { principalId: p, email: e };
}
