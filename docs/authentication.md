# Authentication

CapacityLens has three modes:

- `off` — development/trusted-local only; production refuses this by default.
- `password` — email/password, optionally with experimental social or OIDC providers.
- `sso` — experimental generic OIDC only; password sign-in is disabled.

All auth-on modes require a 32+ character `BETTER_AUTH_SECRET` and an absolute
`BETTER_AUTH_URL`. HTTPS public URLs produce Secure, host-only `__Host-` cookies even when the Node
process sits behind an HTTP reverse proxy. A production process refuses a non-loopback `http://`
public URL.

## Password setup

Set `CAPACITYLENS_AUTH=password` and a 32+ byte `CAPACITYLENS_SETUP_TOKEN`. On an empty instance,
the first-owner form must present that operator secret. After the first identity exists, normal
self-registration is closed. Invite and password-reset links are generated in the product for an
administrator to deliver through their own trusted channel; CapacityLens sends no email.

`CAPACITYLENS_ALLOW_OPEN_SIGNUP=1` deliberately reopens registration and is not recommended for an
internet-facing service.

## Password security and MFA

Password mode uses a 15–128 character policy. New/change/reset credentials are stored with a
versioned scrypt profile (`N=2^17, r=8, p=1`); existing Better Auth hashes remain verify-only
compatible during migration. Passwords containing the product name or an administrative role are
rejected.

Outside tests, candidate passwords are checked against the Have I Been Pwned range API before a
new hash is stored. The server sends only the first five SHA-1 characters and requests padded
results; the password and full digest never leave the process. Creation/change/reset fails closed
when the service is unavailable. `CAPACITYLENS_PASSWORD_BREACH_CHECK=off` disables the lookup for
isolated or offline deployments. Production logs a warning but continues when it is disabled.

Set `CAPACITYLENS_REQUIRE_MFA=1` to require TOTP multi-factor authentication. It is optional and off
by default, including in Compose. When enabled:

1. A newly authenticated user is stopped before tenant data and shown **Secure your account**.
2. They add the TOTP URI to an authenticator, store the one-time recovery codes and verify a
   six-digit code.
3. Later password sign-ins require a TOTP or recovery code.
4. Recovery codes and session bearer tokens are never shown in the normal settings/session list.
5. Disabling MFA is not offered while the deployment requires it.

The TOTP challenge cookie lasts five minutes, authenticator codes use six digits/30 seconds, and
five failed attempts lock the account for fifteen minutes. Trusted-device capability is available
to the auth library for seven days, but the current UI does not request it.

The supported lost-authenticator path is the user's password plus one unused recovery code issued
during enrollment. There is no lower-assurance administrator bypass or email-only MFA reset. If the
user loses both the authenticator and every recovery code, recovery requires an operator-managed
identity re-proofing and account procedure outside the product.

## Sessions and sensitive actions

Sessions have a fixed twelve-hour absolute lifetime with sliding refresh disabled and expire after
thirty minutes of server-observed inactivity. Activity is persisted at most once per minute without
moving the absolute expiry. The inactivity check runs before both CapacityLens routes and direct
authenticated Better Auth routes, so a stale session cannot be used to change credentials. A
session is “fresh” for fifteen minutes after sign-in; membership, invitation, purge, account
deletion and ownership operations require that fresh state and return `SESSION_NOT_FRESH` when the
user must sign in again.

There is no hard concurrent-session count. Fixed/idle/freshness limits, immediate revocation and
visible session inventory form the baseline containment model; required MFA strengthens it when
enabled. SSO session lifetime and termination also depend on the selected provider and must be
tested in staging.

Password users can change their password (revoking other sessions) and inspect/revoke active
sessions in Settings → Security. Administrators may revoke a member's identity-global sessions only
with password-reset-equivalent authority in every account that identity can access. Password reset
also invalidates existing sessions.

## Experimental providers

Google, Microsoft and GitHub are enabled by supplying both provider client-id and client-secret
variables. Generic OIDC uses `CAPACITYLENS_SSO_CLIENT_ID`, `_CLIENT_SECRET` and either a discovery
URL or explicit authorization/token endpoints. A half-configured provider makes startup fail.

External identity creation is invite-gated:

1. The identity provider must assert a verified email.
2. Existing users may link/sign in normally.
3. A new user must match an unused, non-expired pre-authorised invitation.
4. If no user exists yet, the email must appear in comma-separated
   `CAPACITYLENS_SSO_BOOTSTRAP_EMAILS`.

Provider buttons and documentation call this support experimental because callback behavior and
claims differ across identity providers. Test the exact provider and tenant policy in a staging
deployment before production. Prefer single-tenant Microsoft configuration over `common` when the
deployment belongs to one organisation.

To trial SSO while retaining recovery access, keep `CAPACITYLENS_AUTH=password` and configure the
provider. Switch to `CAPACITYLENS_AUTH=sso` only after provider login, invitations and operator
recovery have been tested.

Generic discovery/authorization/token endpoints must be absolute HTTPS URLs; loopback HTTP is
accepted only for development. Embedded URL credentials and malformed provider ids refuse startup.

`CAPACITYLENS_SSO_MFA_ENFORCED=1` is an optional operator attestation that the configured identity
provider enforces MFA for every CapacityLens user. CapacityLens cannot infer equivalent assurance
from every provider's token shape. Set it only after the IdP policy, recovery path, session lifetime
and logout behavior have been exercised in staging; production otherwise continues with a warning.
