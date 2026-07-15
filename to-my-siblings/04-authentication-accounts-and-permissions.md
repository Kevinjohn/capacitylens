# 04 — Authentication, accounts and permissions

Authentication proves identity. Membership grants tenant access. Authorization decides an action.
Keep those three ideas separate in code and documentation.

## Family auth posture

The inherited modes are:

| Mode | Use | Behaviour |
| --- | --- | --- |
| `off` | Development or explicitly trusted local instance | No Better Auth tables/session; trusted-local owner-equivalent access |
| `password` | Stable production default | Email/password; optional experimental providers |
| `sso` | Deliberate SSO-only deployment | Generic OIDC; password sign-in removed |

Production refuses auth-off unless the operator explicitly accepts the open-instance risk.

Password mode may expose configured providers additively. This provides a recovery path while SSO is
being proven. Switch to SSO-only only after exact provider, callback, invitation and recovery flows
are tested in staging.

## Production password security profile

The current family default is deliberately stronger than “Better Auth with a password form”:

- 15–128 character password bounds shared by client and server;
- versioned scrypt hashes at `N=2^17, r=8, p=1` for new/change/reset credentials, with old hashes
  accepted only for verification during migration;
- context-specific product/admin words rejected;
- Have I Been Pwned range lookup on password creation/change/reset: only the first five SHA-1
  characters leave the server, padded results are requested and unavailability fails closed;
- optional required TOTP MFA before a password user may reach tenant data;
- one-time recovery codes shown only during enrolment;
- five failed MFA attempts cause a fifteen-minute lockout;
- fixed twelve-hour sessions with no sliding extension;
- a fifteen-minute fresh-session window for membership/invite/purge/account/ownership operations;
- Settings session inventory/revocation without rendering bearer tokens.

The breached-password lookup is real server egress and must appear in privacy/network documentation.
It remains on by default; an isolated/offline deployment may disable it and receives a production
posture warning.

Keep MFA enrolment outside the tenant shell: after first sign-in the server reports
`mfaRequired=true`, the browser presents **Secure your account**, and the server independently blocks
tenant routes with `MFA_ENROLLMENT_REQUIRED` until enrolment is complete. A hidden client wall is
not enforcement.

## Better Auth boundary

Better Auth should own credential/session/provider mechanics, not product authorization.

Wrap it with local seams:

- server auth adapter: session lookup, user shape and provider configuration;
- browser `AuthProvider`: boot check, login wall, refresh and sign-out;
- pure shared role/action policy;
- server membership/control tables;
- route-level authorization helper.

The browser receives auth mode from `GET /api/auth/me`. There is no client-side build flag that
pretends authentication is on or off.

## Configuration rules

For any auth-on mode:

- require a random secret of at least thirty-two characters;
- require an absolute public URL;
- require HTTPS for non-loopback production URLs;
- derive Secure cookie behaviour from that validated public URL, not untrusted forwarded headers;
- fail startup for half-configured providers;
- disable vendor telemetry where possible;
- list every variable and default in `.env.example`.

Unknown/malformed auth responses render an explicit error surface. Never reinterpret a broken auth
service as auth-off.

## First-owner flow

On a fresh password instance:

```text
no identities
   ↓ /api/auth/me returns 401 + needsSetup=true
owner setup form
   ↓ name + email + password + operator setup token
Better Auth creates identity/session
   ↓
company picker creates first tenant atomically
   ↓
caller receives Owner membership
```

Properties:

- the setup secret is operator-provided, long and never committed;
- setup closes the instant the first identity exists;
- a racing second setup receives a specific closed/setup-taken response and returns to sign-in;
- first tenant creation creates tenant + built-in rows + owner membership atomically;
- production bootstrap credentials are generated one-time values, not well-known defaults.

Identity creation and tenant creation are separate because one identity may later hold several
memberships, even when an instance defaults to one company.

## Signup and invitation posture

Open registration is closed by default.

For password invitation:

1. Admin/owner creates an invitation, optional pre-authorised email and role.
2. The product generates a link; it sends no email.
3. Operator delivers it through a trusted channel.
4. Existing signed-in identity accepts, or an unauthenticated visitor creates a password identity
   through the invite route.
5. Acceptance consumes the invite and creates membership atomically.
6. The account list is refreshed and the new company opens.

For external/OIDC identities:

1. Provider must assert verified email.
2. Existing linked identities may sign in.
3. A new identity must match a live, unused pre-authorised invitation.
4. The very first external identity must also match an operator bootstrap email allow-list.

Provider display support remains “experimental” until the exact provider/tenant policy has been
tested. OIDC claims and callback behaviour vary too much for a generic “works with SSO” promise.

## No built-in email service

CapacityLens deliberately sends no mail. Invite and reset links are generated for an administrator
to deliver.

This is a valid family default for a tiny self-hosted product because it avoids:

- SMTP/provider setup;
- deliverability and abuse handling;
- another subprocessor and retention surface;
- hidden failure states.

A hosted sibling may add mail outside the community core or as an optional adapter. If it does, add
delivery status, retry/idempotency, templates, privacy terms and operator configuration explicitly.

## Tenant/account creation policy

Default to one company per instance unless the product clearly needs multi-company hosting.

- A zero-account instance must permit first company creation.
- In auth-on mode, later company creation requires owner/admin standing.
- A multi-account operator flag explicitly lifts the instance cap.
- Enforce the cap on every creation vector: dedicated route, generic create, PUT/upsert and batch.
- UI `canCreateAccount` is an affordance hint; the server remains authoritative.
- Account creation is a dedicated transaction, not a generic client-side diff.

## Role hierarchy

| Action | Viewer | Editor | Admin | Owner |
| --- | :---: | :---: | :---: | :---: |
| Read tenant data | ✓ | ✓ | ✓ | ✓ |
| Write scheduling/domain data |  | ✓ | ✓ | ✓ |
| Manage members |  |  | ✓ | ✓ |
| Manage invites |  |  | ✓ | ✓ |
| Purge tombstones/read inactive |  |  | ✓ | ✓ |
| Delete whole account |  |  |  | ✓ |
| Transfer ownership |  |  |  | ✓ |

Encode this once in a pure shared `can(role, action)` function. Never scatter
`role === 'admin' || role === 'owner'` across routes and components.

## Member-management interlocks

- Admins cannot grant Owner.
- Admins cannot change, remove or reset the password of an Owner.
- An account must retain at least one Owner.
- Ownership transfer is Owner-only and cannot target self.
- Password reset is an account-takeover capability, not a convenience button.
- Session revocation is identity-global and uses the same cross-account authority as password reset.
- In multi-account mode, resetting another person's global credential requires sufficient standing
  in every account the target belongs to.
- Self-reset may be treated separately because it cannot escalate against another identity.

Rules that require database counts live at the server boundary; pure “who may touch whom” rules live
in shared policy.

## Browser permission boundary

In auth-on server mode:

- resolve the role for the active tenant;
- project pending, failed, missing or malformed role state to Viewer;
- push the resolved role into the store's defense-in-depth guard;
- hide edit affordances through a shared `useCanEdit` hook;
- display a subtle “View only” indicator.

In demo/auth-off mode, no membership role exists. The deliberate null role is editable to keep the
trusted-local/demo path intact.

Viewer gating covers:

- add/edit/archive/delete controls;
- scheduler draw/drag/resize;
- undo/redo that would write;
- import and membership operations;
- onboarding tasks that require writes.

Navigation and read-only exploration remain available.

## Server authorization seam

Every tenant route maps to an action:

```ts
if (!authorize(request, reply, accountId, 'write')) return
```

The helper:

1. obtains user from the trusted auth seam;
2. resolves membership for the asserted account;
3. calls the pure action matrix;
4. sends a consistent refusal;
5. returns false so the route exits.

Do not weaken it because the UI hides a button. Requests can be forged and old clients survive.

## Field visibility is not the action matrix

Some roles may read the record but not every field. Keep predicates such as:

- `canSeeTimeOffNote(role)` — admin/owner;
- `canSeePrivateNames(role)` — owner only.

These select columns/projections after the read action is allowed. They are not new route actions.

## Password-reset links

- Generate short-lived, single-use tokens.
- Store only token hashes.
- Never put raw tokens in list APIs, logs or audit values.
- Keep reset route outside the authenticated tenant shell.
- Verify token and authority again on redemption.
- On success, direct to a fresh sign-in.
- Reconcile member/auth state after an unknown request outcome.
- Revoke existing sessions after a successful credential reset.

## Sessions and step-up

Ordinary reads/writes can use a valid non-fresh session. Administrative actions require a session
created within the fresh window; the server returns a named `SESSION_NOT_FRESH` refusal instead of
silently treating role permission as sufficient. Reauthentication is the recovery path.

A user's active-session list exposes device/IP/timestamps but never the bearer token in rendered
copy. The raw token may cross only the authenticated revoke call. Changing a password revokes other
sessions. An administrator revoking another identity must have reset-equivalent authority across
all the target's accounts, then the server audits `sessionsRevoke` without token values.

## Sign-out

Always erase the current user's offline snapshots before ending the session. Reload after the
sign-out attempt whether it succeeds or fails: an uncertain response may still have cleared the
server session, and tenant data must not remain rendered under ambiguous identity state.

## Auth acceptance checklist

- Fresh password setup works once and closes under a race.
- Wrong/short secrets refuse startup.
- Password hashing parameters, breached-password k-anonymity/fail-closed behaviour and legacy
  verification are tested.
- Password mode boots without required MFA but emits a production warning; the required-MFA path is
  separately tested.
- Pre-MFA identity cannot read tenant data through a forged/direct request.
- Recovery codes are one-time and session tokens never render.
- Sessions expire absolutely and sensitive actions require a fresh sign-in.
- Cross-account session revocation follows credential-reset authority.
- Public HTTP production URL refuses startup.
- Auth service outage never becomes auth-off.
- New external identity requires verified email and invitation.
- Invite cannot cross tenants and cannot be reused.
- Viewer cannot write in UI, store or server.
- Unknown role is read-only/denied.
- Last owner cannot be removed or demoted.
- Admin cannot mint or take over Owner.
- Private fields are projected on every response path.
- Sign-out clears offline identity and reloads.
- Exact provider flow passes in staging before being called supported.
