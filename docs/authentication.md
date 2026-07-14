# Authentication

CapacityLens has three modes:

- `off` — development/trusted-local only; production refuses this by default.
- `password` — email/password, optionally with experimental social or OIDC providers.
- `sso` — experimental generic OIDC only; password sign-in is disabled.

All auth-on modes require a 32+ character `BETTER_AUTH_SECRET` and an absolute
`BETTER_AUTH_URL`. HTTPS public URLs produce Secure session cookies even when the Node process sits
behind an HTTP reverse proxy. A production process refuses a non-loopback `http://` public URL.

## Password setup

Set `CAPACITYLENS_AUTH=password` and a 32+ byte `CAPACITYLENS_SETUP_TOKEN`. On an empty instance,
the first-owner form must present that operator secret. After the first identity exists, normal
self-registration is closed. Invite and password-reset links are generated in the product for an
administrator to deliver through their own trusted channel; CapacityLens sends no email.

`CAPACITYLENS_ALLOW_OPEN_SIGNUP=1` deliberately reopens registration and is not recommended for an
internet-facing service.

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
