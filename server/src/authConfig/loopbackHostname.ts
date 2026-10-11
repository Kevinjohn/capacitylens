/**
 * Recognizes IPv4, IPv6, and localhost loopback hostnames for local-only trust checks.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}
