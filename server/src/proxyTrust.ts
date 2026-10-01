export interface ProxyTrustEnvironment {
  CAPACITYLENS_TRUST_PROXY_HEADERS?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** One deployment posture for both forwarded client identity and public-origin scheme. */
export function canTrustProxyHeaders(environment: ProxyTrustEnvironment, listenHost: string): boolean {
  return environment.CAPACITYLENS_TRUST_PROXY_HEADERS === "1" || LOOPBACK_HOSTS.has(listenHost);
}
