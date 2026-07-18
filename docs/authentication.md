# Authentication and account access

CapacityLens consumes a repository-local account boundary. The browser and product routes depend on
neutral account contracts; Better Auth and SQLite are adapters behind `IdentityPort` and
`AccountAdminPort`. Each installation owns its own local principals, sessions, workspaces,
memberships and invitations. Sibling products share implementation and conformance behavior, not
account records or sessions.

## Deployment profiles

Set `SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE` when an installation should enforce a named posture:

| Profile | Password | Strict OIDC | Intended use |
| --- | --- | --- | --- |
| `self-hosted-password` | yes | no | Independent community install with local credentials |
| `self-hosted-mixed` | yes | yes | Self-hosted transition or deliberate password fallback |
| `self-hosted-sso-only` | no | yes | Self-hosted IdP-only install |
| `hosted-oidc-only` | no | yes | Hosted product; password and named-social configuration refused |

The open-source product does not force SSO. Hosted is SSO-only as a standing product constraint;
weakening it requires an explicit architecture amendment and must not be treated as a sales-time
configuration exception.

`SMALLSASS_ACCOUNT_MODE` accepts `off`, `password` or `sso`. Account mode `off` is trusted-local
development; production refuses it unless the separate product safety override is explicit.
Password and SSO modes require a 32+ character `SMALLSASS_ACCOUNT_SECRET` and an absolute
`SMALLSASS_ACCOUNT_PUBLIC_URL`. Production requires HTTPS outside loopback. HTTPS public URLs use
Secure host-only cookies even when Node sits behind an HTTP reverse proxy.

The former `CAPACITYLENS_AUTH`, `BETTER_AUTH_*`, `CAPACITYLENS_SSO_*` and named-social variables
remain aliases for at least two published minor releases and at least 90 days. A legacy-only value
warns once without logging its value. Canonical and legacy values that differ refuse startup.

## Password profile

Set `SMALLSASS_ACCOUNT_MODE=password` and a 32+ byte `SMALLSASS_ACCOUNT_SETUP_TOKEN`. On an empty
instance, the first-owner form must present that operator secret. After the first identity exists,
normal self-registration closes. Later password identities require an invitation. Invite and reset
links are generated once for an administrator to deliver over their own trusted channel; the
application sends no email and never lists the bearer value again.

`SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP=1` deliberately reopens email registration. It is a
trusted-instance/development escape, not an internet-facing default.

Password mode enforces 15–128 characters, rejects product/context-specific passwords and stores new
hashes with the versioned scrypt profile (`N=2^17, r=8, p=1`). Existing Better Auth hashes remain
verify-only compatible during migration. Outside tests, the candidate is checked against the Have I
Been Pwned range API: only the first five SHA-1 characters leave the process and padded suffixes are
requested. Creation, change and reset fail closed when the service is unavailable.
`SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK=off` is available for isolated deployments and produces a
production warning.

Set `SMALLSASS_ACCOUNT_REQUIRE_MFA=1` to require TOTP for every password identity. A new identity is
stopped before tenant data, records a six-digit/30-second authenticator, stores one-time recovery
codes and proves one code. Five failed attempts lock the account for fifteen minutes. There is no
administrator bypass or email-only MFA reset; losing the authenticator and every recovery code
requires operator-managed identity re-proofing outside the product.

## Sessions and sensitive actions

Local sessions have a fixed twelve-hour absolute lifetime, no sliding refresh and a thirty-minute
server-observed inactivity limit. Activity writes are bounded to once per minute without moving the
absolute expiry. A session is fresh for fifteen minutes; membership, invitation, ownership, purge
and account-erasure operations require fresh authentication.

Password changes and resets revoke existing local sessions. Administrators may reset a password or
revoke sessions only with reset-equivalent authority everywhere the target can enter in this
installation. Authority evaluation and execution are one flow command: membership/security
revisions are rechecked, and a newly issued reset ceremony is burned if authority changes.

## Strict OIDC profile

Strict OIDC is first-class. It is not an arbitrary OAuth compatibility mode. Configure:

```dotenv
SMALLSASS_ACCOUNT_OIDC_CLIENT_ID=capacitylens
SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET=<secret-manager value>
SMALLSASS_ACCOUNT_OIDC_ISSUER=https://identity.example.com
SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL=https://identity.example.com/.well-known/openid-configuration
SMALLSASS_ACCOUNT_OIDC_SCOPES=openid profile email
SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS=first.owner@example.com
```

The exact issuer and discovery document are required. Discovery is the sole authority for
authorization, token, JWKS and user-info endpoints; explicit endpoint overrides are rejected. HTTP
is accepted only for loopback test providers. URL credentials, malformed provider ids, missing
`openid`, symmetric-only signing metadata and non-HTTPS remote endpoints refuse operation.

The relying-party path provides:

- authorization code, state and PKCE S256 handling;
- exact discovery issuer pinning;
- validation of every discovered endpoint before the browser is redirected or the client secret is
  sent; authorization uses a same-origin validation proxy and code exchange refuses redirects;
- ten-second provider fetch deadlines, JSON media-type enforcement and a 1 MiB discovery,
  token-response and user-info ceiling;
- `client_secret_basic` or `client_secret_post` only, selected from discovery metadata;
- signed ID-token verification against remotely refreshed JWKS;
- an asymmetric algorithm allow-list (`RS256`, `PS256`, `ES256`, `EdDSA`);
- client audience, expiry, issued-at and subject validation;
- immediate JWKS refresh for an unknown signing-key id during normal overlap rotation;
- no-redirect, time-bounded JWKS retrieval;
- user-info retrieval using the access token and exact ID-token/user-info subject equality;
- verified-email admission, with missing or false `email_verified` failing admission;
- durable identity correlation by `(issuer, subject)`, never by email.

The first external local principal must have a verified email listed in
`SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS`. Every later new principal must match an unused,
unexpired, preauthorized invitation. Email is an admission attribute only. Once the provider link is
stored, equal or changed emails never merge two identities.

The configured provider id and issuer become an immutable pair in the local database. Renaming a
provider id, repointing it to a different issuer, or reusing an id for another issuer refuses startup
rather than silently changing the namespace of existing subjects. Treat either change as an
identity migration with an explicit reviewed mapping; do not edit the environment in place.

A future SaaS grouping layer may integrate only by acting as an external OIDC provider through this
same public front door. It must not read product account tables or private account APIs.

## OIDC logout and offboarding guarantee

Disabling a person at the IdP prevents new authentication but does not terminate a local product
session already issued. The accepted hosted posture is bounded revocation lag: without an explicit
local administrator revocation, the maximum remaining window is the lesser of thirty minutes of
inactivity or the remaining portion of the fixed twelve-hour absolute lifetime. An actively used
session can therefore remain valid for at most twelve hours from its creation.

Product sign-out terminates the local session only; it does not promise to end the browser's IdP
session. Operator incident response must revoke local sessions in every affected product in
addition to disabling the IdP identity. Back-channel logout, introspection or another near-immediate
cross-product revocation mechanism is deferred, but must be revisited before hosted GA.

Set `SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED=1` only after verifying that the configured IdP requires MFA
for every admitted identity and testing its recovery, session and logout behavior.

## Experimental named providers

Google, Microsoft and GitHub provider buttons remain experimental. They require a complete id/secret
pair and are not accepted by `hosted-oidc-only`. Their support level does not define strict OIDC's
support level. Test the exact provider and tenant policy in staging; prefer a tenant-pinned Microsoft
registration over `common` for a single-organization deployment.

## Verification evidence

The account conformance suite runs with server CI. The strict OIDC gate additionally includes
cryptographic issuer/audience/signature/key-rotation tests and a real Dex browser flow covering
bootstrap, provider callback, local session, preauthorized invitation, membership, account
selection and local-vs-provider logout semantics. See `docs/account-boundary.md` for the contract,
version and sibling propagation model.
