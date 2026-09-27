import { describe, expect, it } from "vitest";
import { isApprovedEmailDomain, parseApprovedDomain, parseApprovedDomains } from "./approvedDomains";

describe("parseApprovedDomain", () => {
  it.each([
    ["EXAMPLE.COM", "example.com"],
    ["staff.example.com", "staff.example.com"],
    ["bücher.example", "xn--bcher-kva.example"],
    ["XN--BCHER-KVA.EXAMPLE", "xn--bcher-kva.example"],
    ["ab--cd.example", "ab--cd.example"],
    [`${"a".repeat(63)}.example`, `${"a".repeat(63)}.example`],
  ])("canonicalizes %s", (input, expected) => {
    expect(parseApprovedDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "example",
    ".example.com",
    "example..com",
    "example.com.",
    "-bad.example",
    "bad-.example",
    `${"a".repeat(64)}.example`,
    `${"a".repeat(50)}.${"b".repeat(50)}.${"c".repeat(50)}.${"d".repeat(50)}.${"e".repeat(50)}.example`,
    "xn--.example",
    "xn--a.example",
    "xn--abc.example",
    "example。com",
    "example．com",
    "example｡com",
    "exa%6dple.com",
    "example%2ecom",
    "exa\\mple.com",
    "https://example.com",
    "user@example.com",
    "example.com/path",
    "example.com?x=1",
    "example.com#hash",
    "example.com:443",
    "*.example.com",
    "[::1]",
    "127.0.0.1",
    "127.1",
    "0x7f.1",
    "staff.123",
    "0x7f000001",
    " example.com",
    "example.com ",
    "exam ple.com",
    "exam\tple.com",
    "exam\nple.com",
    "exam\u0000ple.com",
    "exam\u200bple.com",
    "exam\ud800ple.com",
  ])("rejects %j before or after IDNA conversion", (input) => {
    expect(parseApprovedDomain(input)).toBeNull();
  });
});

describe("parseApprovedDomains", () => {
  it("canonicalizes, deduplicates and sorts multiple domains", () => {
    expect(
      parseApprovedDomains(["Staff.Example.com", "bücher.example", "example.com", "XN--BCHER-KVA.EXAMPLE"]),
    ).toEqual(["example.com", "staff.example.com", "xn--bcher-kva.example"]);
  });

  it("rejects a list with any invalid domain or non-string entry", () => {
    expect(parseApprovedDomains(["example.com", "example。com"])).toBeNull();
    expect(parseApprovedDomains(["example.com", 5])).toBeNull();
    expect(parseApprovedDomains("example.com")).toBeNull();
  });

  it("leaves the empty-list policy decision to the caller", () => {
    expect(parseApprovedDomains([])).toEqual([]);
  });
});

describe("isApprovedEmailDomain", () => {
  it("matches only the exact domain from an authoritative email", () => {
    const domains = ["example.com", "xn--bcher-kva.example"];
    expect(isApprovedEmailDomain("person@EXAMPLE.COM", domains)).toBe(true);
    expect(isApprovedEmailDomain("person@bücher.example", domains)).toBe(true);
    expect(isApprovedEmailDomain("person@staff.example.com", domains)).toBe(false);
    expect(isApprovedEmailDomain("person@notexample.com", domains)).toBe(false);
    expect(isApprovedEmailDomain("person@exаmple.com", domains)).toBe(false);
    expect(isApprovedEmailDomain("person@example。com", domains)).toBe(false);
    expect(isApprovedEmailDomain("person@example%2ecom", domains)).toBe(false);
  });
});
