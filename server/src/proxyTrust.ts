export interface ProxyTrustEnvironment {
  CAPACITYLENS_TRUST_PROXY_HEADERS?: string;
  CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** One deployment posture for both forwarded client identity and public-origin scheme. The
 * canonical setting wins over the compatibility alias so an explicit `0` can retire an old `1`. */
export function canTrustProxyHeaders(environment: ProxyTrustEnvironment, listenHost: string): boolean {
  const canonical = environment.CAPACITYLENS_TRUST_PROXY_HEADERS;
  const canonicalConfigured = canonical !== undefined && canonical !== "";
  const explicitlyTrusted = canonicalConfigured
    ? canonical === "1"
    : environment.CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED === "1";
  return explicitlyTrusted || LOOPBACK_HOSTS.has(listenHost);
}

export function resolveLegacyProxyTrustWarning(environment: ProxyTrustEnvironment): string | null {
  if (
    environment.CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED === undefined ||
    environment.CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED === "" ||
    (environment.CAPACITYLENS_TRUST_PROXY_HEADERS !== undefined && environment.CAPACITYLENS_TRUST_PROXY_HEADERS !== "")
  ) {
    return null;
  }
  return (
    "CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED is deprecated; use " +
    "CAPACITYLENS_TRUST_PROXY_HEADERS. This posture trusts proxy-supplied X-Forwarded-For for " +
    "rate-limit identity and X-Forwarded-Proto for same-origin reconstruction."
  );
}
