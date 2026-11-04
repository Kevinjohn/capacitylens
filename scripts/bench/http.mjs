import assert from 'node:assert/strict';

// Benchmark HTTP calls: timed requests that keep the raw body, and password sign-in.

/** The fictional benchmark identity created through the operator bootstrap invitation. */
export const CREDENTIALS = { email: 'bruce@wayne.example', password: 'benchmark-password-2026' };
const REQUEST_TIMEOUT_MS = 60_000;

const cookieOf = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .join('; ');

export async function request(baseUrl, path, { cookie, token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      'sec-fetch-site': 'same-origin',
      'X-Masquerade-Context': token,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    bytes,
    json: () => JSON.parse(Buffer.from(bytes).toString('utf8')),
  };
}

export async function signIn(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(CREDENTIALS),
  });
  assert.equal(response.status, 200, 'Benchmark sign-in failed');
  const cookie = cookieOf(response);
  const mode = await (await fetch(`${baseUrl}/api/masquerade`, { headers: { cookie } })).json();
  return { cookie, token: mode.contextToken };
}
