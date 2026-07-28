import { describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { cookiesOf } from "./testHelpers";

function responseWithCookies(...cookies: string[]): LightMyRequestResponse {
  return { headers: { "set-cookie": cookies } } as LightMyRequestResponse;
}

describe("cookiesOf", () => {
  it("keeps the last value for each cookie name", () => {
    const response = responseWithCookies(
      "session=stale; Path=/",
      "theme=dark; Path=/",
      "session=fresh; Path=/",
    );

    expect(cookiesOf(response)).toBe("session=fresh; theme=dark");
  });

  it("removes cookies cleared by Max-Age or an expired date", () => {
    const response = responseWithCookies(
      "session=stale; Path=/",
      "session=; Max-Age=0; Path=/",
      "csrf=stale; Path=/",
      "csrf=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
      "current=value; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Path=/",
    );

    expect(cookiesOf(response)).toBe("current=value");
  });
});
