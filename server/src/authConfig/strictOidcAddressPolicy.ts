import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { StrictOidcConfigError } from "./strictOidcErrors";

/** True for hostnames that identify the local loopback interface without a DNS lookup —
 *  localhost, its subdomains, and the IPv4/IPv6 loopback literals as `URL#hostname` renders them
 *  (bracketed for IPv6). Used to permit unencrypted HTTP only for same-machine development
 *  traffic. */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/** IPv4 literals that must never be a server-side fetch destination: this-network, RFC 1918 private,
 * loopback, link-local (cloud instance metadata at 169.254.169.254), CGNAT, multicast and reserved. */
function isPrivateOrReservedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  return false;
}

/** Expand an IPv6 literal to its 16 octets, honouring `::` compression and a dotted-quad tail
 * (e.g. `::ffff:127.0.0.1`). Returns null for anything that is not a well-formed IPv6 address, so
 * callers fail closed. Spelling — hex vs dotted, compressed vs full — cannot change the octets, which
 * is the whole point: `::ffff:7f00:1` and `::ffff:127.0.0.1` must classify identically. */
function ipv6ToBytes(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // fold a trailing IPv4 quad into two hextets
  if (dotted) {
    const quad = dotted[2].split(".").map(Number);
    if (quad.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null; // at most one `::`
  const toOctets = (part: string): number[] | null => {
    if (part === "") return [];
    const octets: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      const value = parseInt(group, 16);
      octets.push((value >> 8) & 0xff, value & 0xff);
    }
    return octets;
  };
  const head = toOctets(halves[0]);
  const tail = halves.length === 2 ? toOctets(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 2) {
    const fill = 16 - head.length - tail.length;
    return fill < 0 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 16 ? head : null;
}

/** True when a resolved address belongs to a non-globally-routable range and so must not receive a
 * server-side OIDC fetch. Any IPv6 form that embeds an IPv4 address (mapped, compatible, 6to4, NAT64)
 * is classified by that embedded address, and anything outside global unicast (2000::/3) fails closed,
 * so a compromised IdP cannot smuggle loopback/RFC1918 past the guard by choosing an exotic spelling. */
function isPrivateOrReservedIPv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  if (!bytes) return true; // unparseable → fail closed
  const embeddedV4 = (offset: number): boolean => isPrivateOrReservedIPv4(bytes.slice(offset, offset + 4).join("."));
  const zeroPrefix = (count: number): boolean => bytes.slice(0, count).every((octet) => octet === 0);

  if (zeroPrefix(15)) return true; // ::/120 covers unspecified (::) and loopback (::1)
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embeddedV4(12); // ::ffff:0:0/96 mapped
  if (zeroPrefix(12)) return embeddedV4(12); // ::/96 deprecated IPv4-compatible
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeroPrefix(12))
    return embeddedV4(12); // 64:ff9b::/96 NAT64
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embeddedV4(2); // 2002::/16 6to4 embeds v4 at octets 2-5
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 docs
  return (bytes[0] & 0xe0) !== 0x20; // only global unicast 2000::/3 is routable; everything else fails closed
}

/** True when a resolved address belongs to a non-globally-routable range and so must not receive a
 * server-side OIDC fetch. Unrecognised inputs fail closed. */
function isPrivateOrReservedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateOrReservedIPv4(address);
  if (version === 6) return isPrivateOrReservedIPv6(address);
  return true; // not an IP literal → fail closed
}

/** Resolve a URL host to its literal addresses (a literal host resolves to itself), throwing a config
 * error tagged with `field` when a name cannot be resolved. */
async function resolveHostAddresses(host: string, field: string): Promise<string[]> {
  const bare = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets for classification
  if (isIP(bare)) return [bare];
  let addresses: string[];
  try {
    const records = await lookup(bare, { all: true });
    addresses = records.map((record) => record.address);
  } catch (cause) {
    throw new StrictOidcConfigError(`OIDC discovery ${field} host could not be resolved.`, { cause });
  }
  if (addresses.length === 0) throw new StrictOidcConfigError(`OIDC discovery ${field} host could not be resolved.`);
  return addresses;
}

/** True when the operator-configured issuer itself lives entirely on a private or reserved network —
 * an intentionally internal deployment, where off-origin internal endpoints are legitimate rather than
 * an SSRF pivot. A public issuer (any globally routable address) returns false so containment stays on.
 * Resolution failures fail safe: unknown means "treat as public", keeping the guard active. */
export async function issuerIsInternal(issuer: URL): Promise<boolean> {
  const bare = issuer.hostname.replace(/^\[|\]$/g, "");
  try {
    if (isIP(bare)) return isPrivateOrReservedAddress(bare);
    const records = await lookup(bare, { all: true });
    return records.length > 0 && records.every((record) => isPrivateOrReservedAddress(record.address));
  } catch {
    return false;
  }
}

/**
 * Endpoints this server dereferences (token exchange, JWKS, user-info) come from the discovery
 * document, which a malicious or compromised IdP controls. The operator-configured issuer origin is
 * trusted, so a document may keep its endpoints there — the common self-hosted case, including
 * loopback development. Any *other* origin is honoured only when it resolves entirely to globally
 * routable addresses, so a compromised IdP cannot redirect a server-side fetch at loopback, cloud
 * instance metadata, or an RFC 1918 service (SSRF). Public split-origin providers keep working. The
 * browser-only `authorization_endpoint` is exempt: the user agent, not this server, dereferences it.
 *
 * Containment is skipped wholesale when the issuer itself is internal (see {@link issuerIsInternal}):
 * a deployment whose IdP is already on a private network gains nothing from blocking private endpoints,
 * and split-origin on-prem providers (issuer and endpoints on distinct internal hosts) keep working
 * with zero configuration. Because the issuer is operator-set, not attacker-controlled, a compromised
 * IdP cannot opt itself into this relaxation.
 *
 * Residual: an endpoint whose DNS answer changes between this check and the fetch (rebinding) is not
 * covered; the bar is a compromised IdP and the impact is low, so pinning the resolved IP onto the
 * connection is deliberately out of scope here.
 */
export async function assertFetchableEndpoint(url: URL, field: string, issuerOrigin: string): Promise<void> {
  if (url.origin === issuerOrigin) return;
  const addresses = await resolveHostAddresses(url.hostname, field);
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new StrictOidcConfigError(
      `OIDC discovery ${field} must not resolve to a private or reserved network address off the issuer origin.`,
    );
  }
}
