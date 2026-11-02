import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Drives a running `docker compose` stack through the public web port: the operator bootstrap link
// creates the first identity, that identity sets up the company, and the company survives an API
// container recreation. Run it only against a disposable stack.

const baseUrl = process.env.CAPACITYLENS_SMOKE_URL ?? 'http://127.0.0.1:8080';
const credentials = { email: 'bruce@wayne.example', password: 'docker-smoke-password-2026' };
const json = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };

function compose(...args) {
  const result = spawnSync('docker', ['compose', ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function cookiesOf(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

async function signIn() {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200, 'Sign-in through the web container failed');
  return cookiesOf(response);
}

const bootstrap = compose(
  'exec',
  '-T',
  'api',
  'node',
  'ace.js',
  'account-kit:admission:bootstrap',
  credentials.email,
  '--role=viewer',
);
// A failed run may still have printed the one-time link; never copy it into CI logs.
assert.equal(bootstrap.status, 0, bootstrap.output.replace(/https?:\/\/\S+/g, '<redacted link>'));
const setupLink = /"url":"([^"]+)"/.exec(bootstrap.output)?.[1];
assert.ok(setupLink, 'The bootstrap command printed no setup link.');
const setupToken = new URL(setupLink).pathname.split('/').filter(Boolean).at(-1);

const signup = await fetch(`${baseUrl}/api/invites/${setupToken}/signup`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ name: 'Bruce Wayne', password: credentials.password }),
});
assert.equal(signup.status, 201, 'First-identity setup failed');

let cookie = await signIn();
const company = await fetch(`${baseUrl}/api/installation/company`, {
  method: 'POST',
  headers: { ...json, cookie },
  body: JSON.stringify({ name: 'Wayne Enterprises' }),
});
assert.equal(company.status, 201, 'Company setup failed');

const recreated = compose(
  'up',
  '--detach',
  '--no-deps',
  '--force-recreate',
  '--wait',
  '--wait-timeout',
  '120',
  'api',
);
assert.equal(recreated.status, 0, recreated.output);

cookie = await signIn();
const accounts = await fetch(`${baseUrl}/api/accounts`, { headers: { cookie } });
assert.equal(accounts.status, 200);
const companies = await accounts.json();
assert.ok(
  companies.some((row) => row.name === 'Wayne Enterprises' && row.role === 'owner'),
  'The company did not survive API recreation',
);
console.log('Docker smoke: first identity, company setup and persistence passed.');
