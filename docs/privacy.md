# Privacy posture

**Privacy-first** is a headline pillar of CapacityLens, not a footnote. Concretely that means
the product **phones home to no one**: it emits no telemetry or usage analytics, runs no email
infrastructure, and introduces no third-party data processor of its own. Your scheduling data
lives in a file you control. The only outside party CapacityLens ever talks to is the identity
provider **you** configure for sign-in — and even then only to sign you in, never to report on
you.

This page documents what ships **today**. It is deliberately honest about the boundaries: it
describes the posture the code actually holds and the automated tests that keep it that way, not
aspirations.

---

## No telemetry, analytics, or product phone-home

CapacityLens sends **nothing about how you use it** anywhere. There is no usage analytics, no
event pipeline, no crash/error reporting service, no "anonymous statistics" toggle (because there
is nothing to toggle). The app does not call out to any analytics, telemetry, or APM vendor —
not in the browser, not on the server.

The one library that *could* phone home is the authentication library, **Better Auth**, which
ships its own optional usage telemetry. We **explicitly disable it** — `telemetry: { enabled:
false }` in `server/src/auth.ts` — so even when authentication is turned on, Better Auth reports
nothing to its maintainers.

## No email infrastructure

The product **never sends email**. There is no SMTP client, no transactional-email vendor, no
verification mail, no password-reset mail, no notification mail. Inviting a teammate is done by a
**single-use, expiring link/token** or by **email-preauthorisation** — you record an address that
binds to the membership *only when that person actually signs in via SSO with a verified email*.
At no point does CapacityLens itself put a message in anyone's inbox.

This is also why [`SECURITY.md`](../SECURITY.md) asks you to use GitHub's private vulnerability
reporting rather than emailing us: **there is no inbox to reach** — the absence of email is by
design, on the reporting side as much as the product side.

## Sign-in talks to your identity provider by redirect, not by us

When you enable SSO, signing in is a **top-level browser redirect** (a navigation), not a
background request. The client wires a generic OAuth2 sign-in (plus an email path); the
provider it redirects to is whichever one you, the self-hoster, configure server-side via
`CAPACITYLENS_*_CLIENT_ID` / `_SECRET` env (e.g. Google, Microsoft, or GitHub). Your browser
navigates to that provider — e.g. `accounts.google.com`, `login.microsoftonline.com`, or
`github.com/login/oauth/authorize` — you authenticate there, and the provider redirects back to
the CapacityLens server's callback. The subsequent **token exchange is server-to-server**: the
CapacityLens server talks to the IdP's token endpoint, the browser is not involved.

The practical consequence: **the browser makes no cross-origin XHR/`fetch` to any IdP origin.**
That is why the Content-Security-Policy `connect-src` directive can legitimately stay `'self'` —
the only programmatic network calls the page makes are same-origin, to the CapacityLens API. The
IdP is contacted **only for sign-in**, and only by navigation (browser) and back-channel token
exchange (server) — never for telemetry, never as a `connect-src` egress target.

## Your data stays on your box

CapacityLens is **server-backed by default**; the in-browser localStorage demo build
(`VITE_CAPACITYLENS_DEMO=1`) keeps all data on the device and never sends it anywhere. In the demo
build, all your data is a single blob in the browser's `localStorage` and never leaves the device.
In the default server-backed build, your data is a **SQLite file on a volume you control** (see
[`docs/self-hosting.md`](self-hosting.md)) —
there is no separate database service, no managed data store, and **no third-party data
processor** beyond the IdP you choose for the sign-in step. Nobody but you (and whoever you give
access to your instance) can read it.

## PII is provably erasable

Removing people's personal data is a first-class, **shipped and tested** capability, not a manual
clean-up:

- **Soft-deleting a resource immediately anonymises its name.** The tombstone's name is scrubbed
  the moment it is soft-deleted — `obfuscateResource` in
  [`shared/src/domain/lifecycle.ts`](../shared/src/domain/lifecycle.ts) — so a removed person's
  name does not linger in the retained row. (Shipped in P2.3.)
- **Deleting a tenant erases that tenant's member identities.** Account hard-delete routes through
  [`server/src/erasure.ts`](../server/src/erasure.ts), which — in one transaction — scrubs each
  affected member's name and email, unlinks their SSO account, and kills their sessions, in the
  auth/membership **control tables** (not the AppData blob). A member who belongs to no other
  account has their identity fully removed; multi-account members are left untouched. (Shipped in
  P2.6.)

Both paths are covered by the automated test suites.

## How this is enforced (the no-egress proof)

The "we send nothing out" claim is **test-backed**, so it can't quietly rot as the code grows.
Two automated guards split across the two test runners hold the line:

1. **A dependency denylist test** —
   [`src/test/privacy-posture.test.ts`](../src/test/privacy-posture.test.ts), run by `npm run
   gate`. It scans every workspace manifest (`package.json` for root, `server/`, and `shared/`)
   **and** the root `package-lock.json` against a curated list of known analytics, telemetry, and
   email packages, and **fails CI** the moment any of them is added — directly or transitively.
   No analytics, telemetry, or email dependency can sneak in unnoticed.
2. **The server CSP `connect-src 'self'` assertion** —
   [`server/src/app.helmet.test.ts`](../server/src/app.helmet.test.ts), run by `npm run
   gate:server`. It asserts the Content-Security-Policy emitted by the server (set by
   `@fastify/helmet`) keeps `connect-src` to **exactly `'self'`** and `default-src` to `'self'`,
   with no external scheme, host, or wildcard. So even a compromised or careless front-end
   **cannot be made to egress to a third party** — the browser is policy-bound to same-origin
   requests.

Together these prove the posture from both ends: nothing in the dependency tree *wants* to phone
home, and the browser's own policy *won't let it*.

---

## Processor note

If you self-host CapacityLens, **you are the data controller and processor** for the data you put
into it. The identity provider you configure for SSO acts as a **processor for the sign-in step
only** — it authenticates your users and tells the server who signed in. **CapacityLens
introduces no other third-party processor**: no analytics vendor, no email vendor, no managed
database. This is a factual description of the data flows, not legal advice; assess your own
obligations for your deployment.
