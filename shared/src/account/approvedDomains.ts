import { isAccountEmail } from "./validation";

// URL hostname conversion provides the same WHATWG IDNA mapping in the browser and Node. Reject
// syntax it would otherwise repair or reinterpret before allowing it to canonicalize Unicode.
const FORBIDDEN_DOMAIN_CHARACTERS = /[%\\/:?#@[\]*\s\p{C}\u3002\uff0e\uff61]/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Parse one exact DNS domain for company admission, without trimming or repairing input. */
export function parseApprovedDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || FORBIDDEN_DOMAIN_CHARACTERS.test(value)) return null;
  if (value.startsWith(".") || value.endsWith(".")) return null;

  let hostname: string;
  try {
    // The platform parser supplies IDNA conversion and rejects malformed A-labels.
    // eslint-disable-next-line no-restricted-globals
    hostname = new URL(`https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (hostname.length > 253 || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return null;
  return hostname;
}

/** Parse a configured domain list into canonical, unique, sorted exact-match keys. */
export function parseApprovedDomains(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const domains: string[] = [];
  for (const candidate of value) {
    const domain = parseApprovedDomain(candidate);
    if (domain === null) return null;
    domains.push(domain);
  }
  return [...new Set(domains)].sort();
}

/** Match the domain of an authoritative verified email against canonical configured domains. */
export function isApprovedEmailDomain(email: string, approvedDomains: readonly string[]): boolean {
  if (!isAccountEmail(email)) return false;
  const domain = parseApprovedDomain(email.slice(email.lastIndexOf("@") + 1));
  return domain !== null && approvedDomains.includes(domain);
}
