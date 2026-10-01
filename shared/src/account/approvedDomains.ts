// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- shared source is compiled by projects that do not include this declaration.
/// <reference path="./tr46.d.ts" />
import { isAccountEmail } from "./validation";
import { toASCII } from "tr46";

// Reject syntax that IDNA conversion would otherwise repair or reinterpret before canonicalizing.
const FORBIDDEN_DOMAIN_CHARACTERS = /[%\\/:?#@[\]*\s\p{C}\u3002\uff0e\uff61]/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Parse one exact DNS domain for company admission, without trimming or repairing input. */
export function parseApprovedDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || FORBIDDEN_DOMAIN_CHARACTERS.test(value)) return null;
  if (value.startsWith(".") || value.endsWith(".")) return null;

  // The same IDNA implementation runs in Node and browsers; platform URL parsers disagree on
  // malformed A-labels such as xn--a.example.
  const hostname = toASCII(value, {
    checkBidi: true,
    checkJoiners: true,
    ignoreInvalidPunycode: false,
    transitionalProcessing: false,
    useSTD3ASCIIRules: true,
    verifyDNSLength: true,
  });
  if (hostname === null) return null;
  if (hostname.length > 253) return null;
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return null;
  // Numeric final labels are interpreted as IP addresses by URL parsers (including short/hex IPv4).
  if (/^(?:\d+|0x[0-9a-f]+)$/.test(labels[labels.length - 1] ?? "")) return null;
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
