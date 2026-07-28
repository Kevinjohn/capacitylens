# Account boundary architecture

> Status: implemented repository-local boundary
> Contract: `1.0.0`
> Conformance: `1.0.0`
> Minimum security version: `1.0.0` (`ACCOUNT-SEC-2026-07-18-01`)

## Outcome

CapacityLens account creation, login/session interpretation, invitations, membership/role
administration, password reset, session revocation, workspace provisioning and tenant erasure now
cross an explicit account boundary. Product code does not select a Better Auth type, identity table
or membership table to perform those operations.

This is deliberate partial decoupling. The boundary is repository-local and uses the same process,
SQLite file, transaction manager and product migration ledger. It does not create a separate account
service, account database, shared runtime identity or common portal. Those would change deployment
and failure semantics and remain behind their recorded triggers.

All asynchronous port implementations must settle in bounded time. The embedded adapters satisfy
that contract through bounded local database waits; network-facing password-screening and OIDC work
has its own abort deadline. Request cancellation is intentionally not propagated into an accepted
durable account command: after reservation, the coordinator must record a terminal or
reconciliation-required outcome even when the client disconnects. Before adding any remote account
adapter, extend the operation context with an `AbortSignal`/deadline, define how expiry interacts
with compensation and reconciliation, and add conformance coverage proving held operation keys are
released. A never-settling adapter is not a conforming implementation.

## Dependency direction

```text
browser account client
        |
account HTTP adapter / product composition root
        |
AccountFlows (ordering, transaction, compensation, idempotency, reconciliation)
       / \
IdentityPort   AccountAdminPort
     |               |
Better Auth       SQLite account adapter
```

The shared `shared/src/account/` leaf contains provider-, framework- and persistence-neutral DTOs,
errors, audit shapes, policy, port interfaces, deployment-profile metadata and validation. It may be
consumed by browser code, server code, fakes and a future package. Architecture tests prevent React,
Fastify, SQLite and Better Auth dependencies from entering it.

`IdentityPort` owns local principals, verified application sessions, password-reset ceremonies,
session inventory/revocation and local-principal deprovisioning. `AccountAdminPort` owns workspaces,
memberships, roles, invitations and the policy facts needed for identity-administration authority.
`AccountFlows` is orchestration-only: it owns sequence, transaction/compensation, keyed locking,
idempotency and reconciliation state. Permission matrices and role ranking stay in pure policy or
the owning port.

Storage ownership is mechanically deny-by-default across `server/src`, rather than checked through
a list of files expected to behave. Identity SQL is confined to the identity adapter/composition;
membership and invitation SQL is confined to the administration adapter and its persistence module.
The same architecture suite follows runtime imports and proves the coordinator has no transitive
path to either adapter or its tables.

Invitation and member-administration HTTP handlers live in
`server/src/accounts/accountRoutes.ts`; `server/src/app.ts` supplies product composition,
authorization and compatibility callbacks. The route adapter imports the administration port and
the coordinator, never the identity adapter or control tables.

The browser uses `src/account/accountClient.ts` for every account endpoint. That client owns request
idempotency headers, reauthentication behavior and the longer timeout used for bulk erasure.

## Trusted application and identity model

`applicationId` and display branding are supplied by server composition, never a request payload.
There is exactly one application per deployment today; keeping the application id in contracts
prevents a future transport from allowing caller-selected authorization scope.

Application display names, TOTP issuers and provider labels are limited to the shared single-line
label length. Password screening accepts at most 32 application-specific context words, and no
context word may exceed the maximum password length. Invalid composition fails during startup
before the branding reaches an identity provider, QR payload or password-policy loop.

A local principal belongs to one product installation. A federated identity is a distinct upstream
fact keyed by exact `(issuer, subject)`. Email is used only for verified initial admission and
preauthorized invitation matching. It is never an account-link or merge key. The same upstream
identity may authenticate into multiple products, producing separate local principals, memberships
and local sessions in each.

`deprovisionLocalPrincipal` removes only the installation's local principal and local credentials,
links and sessions. No adapter is permitted to delete or disable an upstream IdP identity.

## Command and transaction invariants

Every account-administration mutation that needs safe retry or crosses ownership boundaries carries
an independently generated command id and idempotency key. Both values are bearer-grade protocol
secrets: integrations must generate each one independently with a cryptographically secure random
generator, retain it only for that retry ceremony and never derive it from a user, account,
timestamp, sequence or business payload. CapacityLens uses independent RFC 4122 version-4 UUIDs;
other 16–128 character base64url-style values are supported only when they provide equivalent
unguessability. Deterministic or otherwise predictable command ids are unsupported.

This entropy requirement is load-bearing because `commandId` is a globally unique reconciliation
coordinate retained for up to 30 days. Global correlation lets the public status ceremony and the
operator repair tool identify exactly one durable row even after membership or workspace erasure.
It is not a caller-allocated business namespace. A predictable id could be occupied first by an
unrelated request; an unguessable id cannot be targeted before its legitimate use. Callers that omit
the headers receive independent server-generated UUIDs.

Naturally idempotent local sign-out and provider-owned credential endpoints keep their narrower
provider semantics. The server stores a canonical payload digest and terminal semantic result in
`account_commands`. Replaying the same command pair/payload returns the original result; rebinding
either identifier or reusing the key with different semantics returns
`IDEMPOTENCY_CONFLICT`, while a genuinely concurrent retry returns the distinct retryable
`COMMAND_IN_PROGRESS`. Invitation, reset, password and session bearer values are never stored in the
command ledger. A write-once result that cannot safely be reconstructed after process restart
returns a conflict rather than minting a second bearer.

For implicit browser commands, `accountClient` retains the command pair in memory and, when
available, session storage across transport failures, 5xx responses, `COMMAND_IN_PROGRESS`, and any
409 whose body is unreadable or does not carry a recognised terminal code. The in-memory copy keeps
same-page retries idempotent when browser storage is blocked; session storage extends that ceremony
across reloads for the tab. It clears both copies only after success or a definitive caller/policy
rejection. This fail-closed classification prevents a storage policy or truncated proxy response
from turning one unknown command into a second semantic mutation with fresh identifiers.

Every live coordinator command holds a command-specific key in the shared process operation lock.
The reconciliation read validates its bearer first, then acquires that same key before applying the
15-minute abandoned-pending transition. It therefore waits for a live executor to record its actual
outcome and can age only a stale row left without an executor, such as after a process restart. The
command key sorts before principal and workspace keys so flows that discover those coordinates
mid-execution retain the lock-order invariant.

Password invitation signup is **locally atomic, then all-or-compensated**:

1. Validate that the invitation is currently redeemable before identity creation.
2. In one shared-SQLite transaction, create the local user and credential link and correlate the
   pending command to that principal. A restart therefore recovers all three facts or none.
3. Return an opaque compensation handle, then atomically claim the invitation and membership.
4. If the claim fails, delete the provisional local principal.
5. If compensation also fails, persist `reconciliation_required`, retain both internal causes and
   return a retryable `COMPENSATION_FAILED` result.

Reset and administrative session revocation serialize on actor/target keys shared with membership
mutations. Reset evaluates authority, mints the ceremony, then revalidates the security revision. A
changed revision burns the new ceremony; failure to burn it becomes reconciliation-required.
Membership writes bump the revision and revoke outstanding ceremonies.

Workspace provisioning commits product data and the Owner membership in one local transaction.
Workspace erasure commits product deletion, memberships and orphaned local-principal removal in one
local transaction. Before deletion, the product boundary audits every cascading or unbinding
foreign-key edge whose parent belongs to the target workspace; if a child is labelled for another
workspace, erasure fails closed and the transaction leaves both tenants intact for operator repair.
Closed command history scoped to the erased workspace or an erased local principal is removed in
that transaction. Pending and reconciliation-required workspace commands remain durable until they
can record or reconcile their external outcome; they are coordination and recovery state, not
history. The terminal erasure command is retained only for bounded safe replay, with
workspace/principal correlation fields cleared. Its authenticated HTTP route checks that exact
completed command before consulting the now-erased membership, so a lost success response can be
retried without authorising any fresh deletion. Upstream identities are untouched.

Cross-port terminal outcomes are emitted by `AccountFlows` as normalized `AccountAuditEvent`
records. Their stable correlation contains application/workspace/principal/command identifiers,
outcome and fixed field names only. Bearer inputs and field values never enter the event. The same
fail-never sink retains the existing product mutation audit shape for operator compatibility and
latches degradation for deep health.

Database schema version 17 adds the product mutation audit outbox. Its record commits with the
product write, then drains to the compatible sink with stable delivery correlation; normalized
cross-port outcome events retain their coordinator-owned delivery semantics.

Database schema version 18 adds durable per-browser sync ordering and exact row-result provenance.
The sequence watermark and provenance update in the same transaction as the represented product
batch. A late predecessor is a successful no-op; a successor may advance past its own predecessor's
server revision only while the stored row still hashes to that exact result. An intervening write
therefore remains a conflict rather than being mistaken for same-session progress.
Provenance is account-scoped operational metadata and is deleted in the same transaction as tenant
erasure; the device-session watermark contains no account data and expires after seven days.

Database schema version 19 adds a database-enforced tenant relationship boundary. Every scoped
parent reference must resolve to a row with the same `accountId`, and a scoped row's `accountId`
cannot be changed in place. Startup verifies both the live relationship graph and the exact trigger
bodies, so a corrupt restore or altered guard fails closed before the API starts.

## Persistence and migration

Database schema version 15 adds the command ledger, security revisions, principal-owned per-session
assurance and immutable issuer/provider bindings through an explicit checksummed migration. Account
and product changes intentionally remain in the one product ledger so
one file, one backup and one rollback snapshot remain the supported operating model.

Before a second consumer promotes schema-bearing account code to a package, the following integration
model is a release gate:

1. The account package publishes immutable, content-addressed migration definitions.
2. Each product pins or snapshots the exact definition into its own next product migration.
3. Each product records the incorporated account-schema version separately from its product schema.
4. A released product migration never calls a mutable current-schema helper from a later package.
5. Account release notes declare required product migrations and compatible schema ranges.
6. Released database fixtures and migration rehearsals run in every consuming sibling.

Package promotion may break the pre-1.0 repository-local contract after mandatory first-sibling
review. A separate account database or service is not implied by promotion.

## OIDC boundary

Strict OIDC is the supported external identity front door and is tested independently of named
social providers. Better Auth owns authorization state, PKCE, cookies and local link persistence.
The strict adapter owns validated-endpoint selection and the bounded, no-redirect code exchange.
The strict profile additionally verifies discovery issuer, signed ID token, client audience,
asymmetric algorithm, timestamps, remotely refreshed JWKS and user-info subject equality.

The auth vendor hook receives an injected admission decision. It does not read membership or
invitation tables. The account adapter exposes only the live-preauthorized-invitation fact, while
identity storage owns the first-local-principal fact. Missing verification or missing admission
facts fail closed.

Hosted uses `hosted-oidc-only`, which refuses password configuration, open signup and named social
providers. A future bundling layer must register as an ordinary external OIDC provider; it may not
integrate with these internals.

## Conformance and drift control

`shared/src/account/conformance.ts` publishes contract, conformance, minimum-security and profile
metadata independently of the product version. The named `Account boundary · ports · policies ·
architecture` CI check runs pure policy/contract tests, fake-flow conformance, local account-adapter
tests, profile validation and architecture dependency tests independently of the ordinary server
gate. One capability-aware identity contract runs unchanged against the Better Auth adapter,
trusted-local adapter and vendor-free fake; a profile may omit credentials, reset or administrative
revocation only through the normalized fail-closed `UNSUPPORTED_CAPABILITY` result.

The independent `Strict OIDC conformance · pinned Dex` E2E job adds a fault-controlled discovery
front door. It proves bootstrap,
preauthorized invitation, stable issuer/subject re-entry, local sign-out, provider denial, callback
failure, malformed discovery and provider unavailability through the real product browser surface.

Identical behavior means identical within the same named deployment profile. Password and SSO-only
products intentionally expose different credential ceremonies.

The sibling handbook owns the implementation registry and propagation procedure. Passing an old
conformance suite is not evidence of current security; every sibling must meet the recorded minimum
version and attach CI evidence for each security-fix identifier.

## Known accepted limits

- Flow identity across repositories is maintained by version discipline and conformance CI, not a
  single deployed runtime.
- IdP disablement blocks new sign-ins but does not instantly revoke already-issued local sessions.
  The current maximum is twelve hours absolute or thirty minutes of inactivity. Back-channel logout
  must be reconsidered before hosted GA.
- Named social providers remain experimental.
- The account routes retain their public CapacityLens URL shapes for compatibility; decoupling is an
  ownership and dependency boundary, not a forced public API migration.
