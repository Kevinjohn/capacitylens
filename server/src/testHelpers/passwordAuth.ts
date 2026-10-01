import { expect } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

// Password-mode request helpers shared by the auth-backed server suites (app.*.test.ts): the
// password env, the typed inject wrapper, the two Set-Cookie readers and the sign-up flow.
// The auth-backed app itself is built by fixtures/appWithAuth.ts.

/** Password-auth env for `authFromEnv`. Open signup is CLOSED by default (P1.7 disableSignUp); these
 *  fixtures create users via sign-up/email, so it is re-opened here until the invite flow is the only
 *  path. A suite that asserts the default-closed posture builds its own env WITHOUT this flag. */
export const PASSWORD_ENV = {
  CAPACITYLENS_MODE: "password-only",
  CAPACITYLENS_SECRET: "unit-test-secret-0123456789abcdef-0123",
  CAPACITYLENS_PUBLIC_URL: "http://localhost:8787",
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
};

/** `app.inject` typed as the light response the suites assert against. */
export const call = (app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(options);

/** Normalise a possibly-repeated response header to a list of its values. */
export function headerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

/** Report every Set-Cookie pair the server sent, in order, as one request Cookie header. Unlike
 *  readCookies this keeps duplicates and cleared cookies: app.auth.bootstrap.test.ts asserts that a
 *  rejected sign-up set no session cookie at all, so a cleared cookie must remain visible there. */
export function cookiesOf(res: LightMyRequestResponse): string {
  return headerValues(res.headers["set-cookie"])
    .map((cookie) => String(cookie).split(";")[0])
    .join("; ");
}

/** Collapse a response's Set-Cookie header(s) into one request Cookie header, as a browser cookie
 *  jar would: the last value per name wins and expired cookies are dropped. */
export function readCookies(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  let list: readonly string[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw) list = [raw];
  const cookies = new Map<string, string>();
  for (const header of list) {
    const [pair, ...attributes] = String(header).split(";");
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const expired = attributes.some((attribute) => {
      const [rawName, ...rawValue] = attribute.trim().split("=");
      if (!rawName) return false;
      const attributeName = rawName.toLowerCase();
      const value = rawValue.join("=").trim();
      if (attributeName === "max-age") return Number(value) <= 0;
      if (attributeName !== "expires") return false;
      const expiresAt = Date.parse(value);
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    });
    if (expired) cookies.delete(name);
    else cookies.set(name, pair.trim());
  }
  return [...cookies.values()].join("; ");
}

/** Sign up a user, returning its session cookie + the resolved user id (from /api/auth/me). */
export async function signUp(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await call(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "password-123456", name: "Tester" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = readCookies(res);
  const me = await call(app, {
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie },
  });
  expect(me.statusCode).toBe(200);
  return { cookie, userId: me.json<{ user: { id: string } }>().user.id };
}
