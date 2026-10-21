/**
 * Marks certificates as expiring within thirty days so operators can renew before expiry.
 */
export const INTERNAL_TLS_RENEW_BEFORE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Summarizes the internal certificate expiry status and remaining lifetime.
 */
export interface InternalTlsHealth {
  status: "ok" | "expiring" | "expired";
  expiresAt: string;
  daysRemaining: number;
  fingerprintSha256?: string;
}

const resolveInternalTlsStatus = (remainingMs: number): InternalTlsHealth["status"] => {
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= INTERNAL_TLS_RENEW_BEFORE_SECONDS * 1_000) return "expiring";
  return "ok";
};

/** Constant-work health projection over the certificate metadata parsed once at startup. */
export function buildInternalTlsHealth(
  expiresAt: string,
  now = Date.now(),
  fingerprintSha256?: string,
): InternalTlsHealth {
  const parsedExpiry = Date.parse(expiresAt);
  const remainingMs = Number.isFinite(parsedExpiry) ? parsedExpiry - now : 0;
  return {
    status: resolveInternalTlsStatus(remainingMs),
    expiresAt,
    daysRemaining: Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1_000))),
    ...(fingerprintSha256 ? { fingerprintSha256 } : {}),
  };
}
