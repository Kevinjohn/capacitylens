import { describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { cookiesOf, readCookies } from "./passwordAuth";

function responseWithCookies(...cookies: string[]): LightMyRequestResponse {
  return { headers: { "set-cookie": cookies } } as LightMyRequestResponse;
}

describe("readCookies", () => {
  it("keeps the last value for each cookie name", () => {
    const response = responseWithCookies("session=stale; Path=/", "theme=dark; Path=/", "session=fresh; Path=/");

    expect(readCookies(response)).toBe("session=fresh; theme=dark");
  });

  it("removes cookies cleared by Max-Age or an expired date", () => {
    const response = responseWithCookies(
      "session=stale; Path=/",
      "session=; Max-Age=0; Path=/",
      "csrf=stale; Path=/",
      "csrf=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
      "current=value; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Path=/",
    );

    expect(readCookies(response)).toBe("current=value");
  });
});

describe("cookiesOf", () => {
  it("keeps every Set-Cookie pair in order, including duplicates and cleared cookies", () => {
    const response = responseWithCookies("session=stale; Path=/", "session=; Max-Age=0; Path=/", "theme=dark; Path=/");

    expect(cookiesOf(response)).toBe("session=stale; session=; theme=dark");
  });
});
