# Authentication and account access

CapacityLens consumes a repository-local account boundary. The browser and product routes depend on
neutral account contracts; Better Auth and SQLite are adapters behind `IdentityPort` and
`AccountAdminPort`. Each installation owns its own local principals, sessions, workspaces,
memberships and invitations. Sibling products share implementation and conformance behavior, not
account records or sessions.

## Deployment profiles

Set `SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE` when an installation should enforce a named posture:

| Profile                | Password | Strict OIDC | Intended use                                                    |
| ---------------------- | -------- | ----------- | --------------------------------------------------------------- |
| `self-hosted-password` | yes      | no          | Independent community install with local credentials            |
| `self-hosted-mixed`    | yes      | yes         | Self-hosted transition or deliberate password fallback          |
| `self-hosted-sso-only` | no       | yes         | Self-hosted IdP-only install                                    |
| `hosted-oidc-only`     | no       | yes         | Hosted product; password and named-social configuration refused |

Moving an existing password installation onto SSO is a supported, staged procedure: the operator
steps live in [runbook.md](runbook.md#password-to-sso-cutover), and
[sso-cutover-guide.html](sso-cutover-guide.html) walks the same nine steps with screenshots for
self-hosters. [company-login-guide.html](company-login-guide.html) is the jargon-free version of
this page's OIDC requirements, written as click-by-click instructions for Google Workspace,
Entra ID, Okta and Keycloak — send self-hosters there rather than here.

The open-source product does not force SSO. Hosted is SSO-only as a standing product constraint;
weakening it requires an explicit architecture amendment and must not be treated as a sales-time
configuration exception.

`SMALLSASS_ACCOUNT_MODE` accepts `off`, `password` or `sso`. Account mode `off` is trusted-local
development; production refuses it unless the separate product safety override is explicit.
Password and SSO modes require a 32+ character `SMALLSASS_ACCOUNT_SECRET` and an absolute
`SMALLSASS_ACCOUNT_PUBLIC_URL`. Production requires HTTPS outside loopback. HTTPS public URLs use
Secure host-only cookies even when Node sits behind an HTTP reverse proxy.

The former `CAPACITYLENS_AUTH`, `BETTER_AUTH_*`, `CAPACITYLENS_SSO_*` and named-social variables
remain aliases until both two stable minor releases and 90 days have elapsed from the first stable
release containing the canonical namespace. Prereleases do not start that clock: when
0.26.0 stable ships, record its release date and remove no earlier than 0.28.0 and 90 days after that
date. A legacy-only value warns once without logging its value. Canonical and legacy values that
differ refuse startup.

## Password profile

Set `SMALLSASS_ACCOUNT_MODE=password` and a 32+ byte `SMALLSASS_ACCOUNT_SETUP_TOKEN`. On an empty
instance, the first-owner form must present that operator secret. After the first identity exists,
normal self-registration closes. Later password identities require an invitation. Invite and reset
links are generated once for an administrator to deliver over their own trusted channel; the
application sends no email and never lists the bearer value again.

`SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP=1` deliberately reopens email registration. It is a
trusted-instance/development escape, not an internet-facing default.

Password mode enforces 15–128 Unicode code points, rejects product/context-specific passwords and
stores new hashes with the versioned scrypt profile (`N=2^17, r=8, p=1`). Existing Better Auth
hashes remain verify-only compatible during migration. Outside tests, the candidate is checked
against the Have I Been Pwned range API: only the first five SHA-1 characters leave the process and
padded suffixes are requested. Creation, change and reset fail closed when the service is
unavailable.
Identity names and provider labels use the same Unicode-code-point meaning of “character”; email's
254 limit is measured in UTF-8 bytes.
`SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK=off` is available for isolated deployments and produces a
production warning.

Set `SMALLSASS_ACCOUNT_REQUIRE_MFA=1` to require TOTP for every password identity. A new identity is
stopped before tenant data: the browser does not begin tenant persistence until `/api/auth/me`
admits the session, and the server independently refuses tenant routes while enrollment remains
required. The identity records a six-digit/30-second authenticator, stores one-time recovery
codes and proves one code. Five failed attempts lock the account for fifteen minutes. There is no
administrator bypass or email-only MFA reset; losing the authenticator and every recovery code
requires operator-managed identity re-proofing outside the product. Mandatory enrollment also
outranks public-entry links for a signed-in identity. The wall explains that invitations require
enrollment before acceptance and that signing out reopens an admin-issued password-reset link in
its intended session-free flow.

## Sessions and sensitive actions

Local sessions have a fixed twelve-hour absolute lifetime, no sliding refresh and a thirty-minute
server-observed inactivity limit. Activity writes are bounded to once per minute without moving the
absolute expiry. A session is fresh for fifteen minutes; membership-authorized company
provisioning, membership, invitation, ownership, purge, inactive-state export and account-erasure
operations require fresh authentication.

The in-place recent-authentication dialog accepts either the enrolled authenticator code or one
unused recovery code. Recovery codes therefore remain the supported fallback for sensitive actions
without forcing a sign-out that discards the user's current working state.

Password changes and resets revoke existing local sessions. Administrators may reset a password or
revoke sessions only with reset-equivalent authority everywhere the target can enter in this
installation. Authority evaluation and execution are one flow command: membership/security
revisions are rechecked, and a newly issued reset ceremony is burned if authority changes.

The Owner rule is absolute in-product: no admin can ever reset an Owner's credential, and the
exactly-one-active-Owner invariant means no second Owner exists to help. The sole Owner losing
their password is therefore recovered by the operator, not in the product — a stopped-server CLI
(`reset:owner-password`) that drives this same reset ceremony under an exclusive database lock.
See the "Sole-Owner credential recovery" procedure in `docs/runbook.md`. A credential reset
changes no ownership; explicit atomic transfer remains the only ownership-change path.

Invitation and password-reset creation responses contain write-once bearer tokens. To reconcile an
immediately lost response, the server may replay the same bearer for the same authorized command for
up to five minutes. This cache is process-local, entry-bounded and independent of the bearer expiry;
after five minutes the plaintext value is discarded and the completed command returns a conflict
rather than reconstructing or redisclosing the secret. If every replay slot is occupied, the server
returns retryable rate-limit backpressure before minting another bearer; it never evicts an earlier
completed response to admit the new issuance. Durable command state stores only digests and non-secret
metadata.

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
is accepted only for loopback test providers. URL credentials, malformed or reserved provider ids, missing
`openid`, `profile` or `email` scopes, symmetric-only signing metadata and non-HTTPS remote endpoints
refuse operation. The three scopes are required because CapacityLens binds the subject and consumes
the provider's email and display name during sign-in; verified email is mandatory for first
admission and explicit linking.
The registered `SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL` and
`SMALLSASS_ACCOUNT_OIDC_TOKEN_URL` names exist only to map bounded legacy configuration; every
named deployment profile rejects them. Do not set them for a supported deployment.

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
- verified-email admission, with missing or false `email_verified` failing admission unless the
  exact returning provider row has durable verified-admission evidence;
- durable identity correlation by `(issuer, subject)`, never by email.

The first external local principal must have a verified email listed in
`SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS`. Every later new principal must match an unused,
unexpired, preauthorized invitation. Email is an admission attribute only. Once the provider link is
stored, equal or changed emails never merge two identities.

Used invitation rows are operational history, bounded to the newest 200 per company and 365 days.
Live unused invitations retain their ordinary expiry and explicit-revocation lifecycle. External
identity admission performs an indexed lookup over only unused preauthorized invitation rows.

On a fresh `self-hosted-mixed` deployment, the first-run wall shows both the setup-token password
form and every configured external provider. The allow-listed first owner can therefore bootstrap
through OIDC directly; creating an interim password owner is not required.

### Password-to-SSO cutover

An existing password installation migrates through `self-hosted-mixed`; do not flip directly from
password-only to SSO-only. Mixed mode keeps password sign-in available while each member uses
Settings → Security → **Connect your SSO account**. Linking preserves the local principal id,
memberships, Owner seat, and every scheduling record. The callback requires the configured strict
provider, a verified IdP email equal to the local email, and a provider subject not already claimed
by another principal. Linking an existing admitted principal does not consume an invitation.

Owner/Admin can monitor **SSO cutover readiness** in Team & access. During mixed-mode staging, an
identity-global fresh administrator may correct a member's local email or remove an incorrect
provider link; either action revokes that member's sessions and pending ceremonies and is audited.
Raw provider link/unlink routes are shadowed, and the required provider cannot be self-unlinked.

The operator's authoritative check is:

```bash
pnpm --filter capacitylens-server cutover:preflight -- /absolute/path/to/capacitylens.db
```

It evaluates all companies and names blocking people, including unlinked members, missing
principals, multiple/unverified links (including legacy strict-provider links held by non-members),
configured-social-only non-members, duplicate subjects, ownerless/memberless companies, providerless
or credential-only orphans, and open signup. Live reset ceremonies are also reported,
but they are revocable state rather than blockers: first cutover atomically deletes them after every
non-revocable check passes. Expired verification rows are not outstanding. Provider rows created before durable
verified-admission observations existed are intentionally unverified until removed and relinked in
mixed mode. This also applies when upgrading an installation that was already SSO-only: restore the
previous image if necessary, switch it to mixed mode, establish password recovery, then upgrade and
complete the verified relink before returning to SSO-only. CapacityLens does not infer verified
admission from a legacy row because older raw provider-link routes did not require that proof.
After it passes, stop application traffic, change the profile and mode to
`self-hosted-sso-only`/`sso`, and restart. Startup reruns the interlock after both application and
Better Auth migrations, proves readiness before changing live state, atomically revokes first-cutover
sessions and reset/verification ceremonies, records a durable application-scoped activation marker
with the activation audit, and refuses to serve if readiness changed. Later clean SSO-only restarts
preserve federated sessions. Self-hosted SSO-only requires one strict OIDC
provider and remains compatible with configured experimental named social providers for existing
members; named social callbacks cannot create a new local principal after cutover, and accepting an
SSO-only invitation or provisioning a company requires signing in through the strict provider. Hosted
OIDC-only accepts only strict OIDC. SSO-only requires email-preauthorised invitations and shadows
password reset, password change and reset redemption.

Credential rows are retained but dormant. Day-zero rollback is therefore a stopped-server
configuration revert to `self-hosted-mixed`/`password` plus restart. Users first created through SSO
after cutover have no password and need an individual reset after mixed mode returns. See the
cutover and IdP-outage procedures in `docs/runbook.md`.

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
session. The browser publishes the local sign-out boundary to sibling tabs before navigation, so
they immediately hide tenant state and recheck their session rather than retaining stale controls.
Operator incident response must revoke local sessions in every affected product in
addition to disabling the IdP identity. Back-channel logout, introspection or another near-immediate
cross-product revocation mechanism is deferred, but must be revisited before hosted GA.

Set `SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED=1` only after verifying that the configured IdP requires MFA
for every admitted identity and testing its recovery, session and logout behavior.

CapacityLens treats every federated session as satisfying its local required-MFA gate because it
cannot inspect the provider's upstream authentication policy. This includes experimental named
providers in mixed mode. Enforcing and testing provider-side MFA is therefore the operator's
responsibility; the assurance flag records that operational decision for the strict SSO profile.

## Experimental named providers

Google, Microsoft and GitHub provider buttons remain experimental. They require a complete id/secret
pair and are not accepted by `hosted-oidc-only`. Their support level does not define strict OIDC's
support level. Test the exact provider and tenant policy in staging; prefer a tenant-pinned Microsoft
registration over `common` for a single-organization deployment.

## Verification evidence

The account conformance suite runs with server CI. The strict OIDC gate additionally includes
cryptographic issuer/audience/signature/key-rotation tests and a real Dex browser flow covering
bootstrap, provider callback, local session, preauthorized invitation, membership, account
selection and local-vs-provider logout semantics. Separate fresh-process Dex runs inject malformed
discovery and provider unavailability; callback-shaped denial/failure cases prove the product's
retryable, non-reflecting browser error surface. A pre-module external bootstrap strips provider
error fields from a marked return before hydration, retaining only the product marker; the signed-out
wall, invitation flow or authenticated shell consumes that marker and removes it after rendering the
stable message. Explicit provider-link failure markers receive the same pre-hydration diagnostic
scrub and return to their validated per-flow settings URL. Provider detail therefore does not depend on successful application hydration to
leave the address bar. See `docs/account-boundary.md` for the contract, version and sibling
propagation model.
