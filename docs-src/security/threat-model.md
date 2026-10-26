---
title: CapacityLens threat model
description: The security objectives, assets, actors, abuse cases and accepted risks that shape CapacityLens's design, reviewed 2026-10-26.
---

# CapacityLens threat model

Baseline version: 2026-09-23. Authentication posture reviewed: 2026-10-26, after the Account Kit
cutover in #1582. This update reconciles current controls; it is not a fresh review of the full
model. Review the model after changes to authentication, tenancy, imports, browser storage,
deployment topology or external services.

## Security objectives

1. A user can read or change only accounts, operations, records and protected fields allowed by
   their current server-side membership and role.
2. Passwords, session tokens and emailed bearer links are not disclosed or stored in recoverable
   form where a safer representation is available.
3. Tenant writes remain valid, atomic and attributable; corrupted relational state prevents startup.
4. Browser-delivered code cannot silently turn an authenticated browser into a cross-site write
   primitive, and sensitive API responses are not cached.
5. Operators can contain a compromised identity, restore authoritative data and investigate the
   application audit record without relying on the compromised host alone.

CapacityLens is not a safety-critical, payments, classified-data, real-time media or anonymous
public-upload system. Availability is important, but confidentiality and tenant integrity take
priority over keeping a misconfigured production process running.

## Assets and trust boundaries

| Asset | Primary protection | Boundary |
| --- | --- | --- |
| Company schedule and private client/project names | Server membership, action/field authorization, SQLite constraints | Browser/API and company boundary |
| Identity, password verifier and admission state | Account Kit password flows, application admission policy and account database | Authentication/API and database boundary |
| Session and emailed action-link secrets | HttpOnly session cookie; high-entropy one-time links stored by digest and expired | Browser/API, SMTP and operator boundary |
| Owner/Admin view-as-member state | Session-bound SQLite row; read projection only; server middleware refuses writes | Session, company and authorization boundary |
| Database, WAL, audit rows and snapshots | File permissions, single-process SQLite ownership and operator-protected storage | Process/host boundary |
| Application keys and SMTP credentials | `APP_KEY` and mail settings supplied by the operator | Deployment secret store and process boundary |
| Build and release inputs | Lockfile, pinned workflow actions, dependency review, SBOM, scans and provenance | Contributor/CI/registry boundary |

The browser talks to the application over the configured public origin. Operators terminate public
TLS and protect the host, database and snapshots. SMTP is the only default outbound application
service; its configured connection requires TLS and certificate verification. Emailed action links
place bearer values in URL paths, so access logs at the proxy or mail service must not record them.

## Actors

- A Viewer, Editor, Admin or Owner acting maliciously within their legitimate account.
- An authenticated user attempting cross-company or higher-role access.
- An unauthenticated internet attacker, credential-guessing bot or cross-site origin.
- A person with access to a mailbox, forwarded invitation or compromised browser/device.
- A malicious or compromised dependency, build input or release credential.
- A self-hosting operator who makes an unsafe configuration choice or misuses operator access.
- A host-level attacker. In-process controls cannot fully contain host compromise; isolation,
  secret management and off-host backups/logs limit consequences.

## Abuse cases and controls

Test paths below are relative to `apps/backend/tests/functional/` unless the full path is shown.

| Threat | Principal controls | Verification evidence |
| --- | --- | --- |
| Cross-company read/write or role escalation | Server membership and role checks on each operation; scoped rows carry `account_id`; protected fields are projected or preserved server-side | `membership/control_data_isolation.spec.ts`, `auth/native_authorization.spec.ts` |
| Cross-site request or cached confidential response | Unsafe-origin and Fetch Metadata checks; same-origin policy; `/api/*` responses use `no-store` | `http_contract.spec.ts`, `http_parser_regressions.spec.ts` |
| Credential guessing or password reuse | Product password creation/change/reset enforce 15–128 Unicode code points; Account Kit throttles authentication; product API limits requests; there is no breached-password screening or local MFA | `auth/native_auth_limits.spec.ts`, `auth/password_sessions.spec.ts`; no automated breached-password check |
| Password verifier cracking | Node scrypt uses `N=2^14`, `r=8`, `p=1`; this profile is below the documented OWASP scrypt parameter recommendation at the same memory target | `apps/backend/config/hash.ts`; no automated parameter-strength test |
| Stolen session or fixation | Secure, HttpOnly, SameSite session cookies; authentication regenerates the session; server-side session registry expires after 14 days without use; there is no absolute lifetime or concurrent-session cap; password change/reset revokes sessions | `auth/password_sessions.spec.ts` |
| View-as-member used to perform a write | Projection is tied to the real actor's Kit session and company; middleware rejects unsafe requests and sensitive reads while active | `auth/masquerade.spec.ts` |
| Stolen Owner session used for a sensitive operation | Password proof is required for ownership transfer, import and anonymisation; proofs are single-use, time-limited and bound to the user, Kit session, company, action and intent | `membership/ownership_transfer.spec.ts`, `transfer_apply.spec.ts`, `anonymise.spec.ts` |
| Forwarded or intercepted invitation link | Invitation expires after seven days; revoking/resending replaces it; preview does not spend it; acceptance confirms the address and still requires admission approval | `auth/invitations.spec.ts`, `auth/admission.spec.ts` |
| Unauthorized admission, invitation abuse or flooding | Product routes require a confirmed address and admission; invitation creation rechecks inviter authority in the insert transaction; Kit throttles invitation creation and resend by actor and recipient; approvers can decide only for identities they may administer | `auth/admission.spec.ts`, `auth/invitations.spec.ts`, `auth/native_authorization.spec.ts` |
| Sign-in or proof flooding | Account Kit defaults to 10 requests/minute per client and 5/minute per identity with a 20-minute identity block; production API defaults to 300 requests/minute per IP; sign-in and action-proof password checks share a 3-per-10-second per-IP failure budget | `apps/backend/config/account_kit.ts`, `apps/backend/app/services/auth/request_limit.ts`, `auth/native_auth_limits.spec.ts`, `request_limits.spec.ts` |
| First-identity race or open-signup bypass | Before a company exists, setup is restricted to one operator-invited identity; the company creation path rechecks the sole-principal condition under the transaction lock | `auth/first_company_setup.spec.ts` |
| Password reset operator misuse | `owner:reset-password` requires the server to be stopped, an eligible sole active Owner, and an audit record before displaying the link | `auth/recovery.spec.ts` |
| Operator-issued reset outside product recovery | Account Kit commands are registered for the operator. Their authority is host/database authority; the packaged `account-kit:reset-link` command does not use the product's sole-Owner recovery checks or write the product audit row | No automated test covers the command's audit behavior; code gap G2 is separate from this documentation update |
| Injection, malformed writes or unsafe imports | Vine validation strips unknown fields; ordinary writes reject invalid input; import is Owner-only, validates references and replaces data atomically | `http_parser_regressions.spec.ts`, `transfer_apply.spec.ts`, `planning/transactions.spec.ts` |
| Database corruption or partial write | Startup checks SQLite foreign-key integrity; write transactions, WAL and operator backups support recovery | `state/database_contract.spec.ts`, `transaction_faults.spec.ts`, `backup_diagnostics.spec.ts`; restore procedures are operator-run |
| Log leakage or uninvestigated authentication | Application audit rows are stored in SQLite. No auth-specific success, failure or throttling event is written; the optional request log records route/status metadata but not a complete authentication event; bearer values are excluded | `logging.spec.ts`; no automated test covers authentication event logging, which is a separate code gap |
| Resource exhaustion | 512 accepted-socket ceiling, 30-second request limit, password and request throttles, one SQLite connection, and framework request-body limits | `request_limits.spec.ts`, `auth/native_auth_limits.spec.ts`, `backup_diagnostics.spec.ts`, `transfer_apply.spec.ts` |
| Supply-chain compromise | Lockfile-pinned dependencies, Dependabot, CodeQL, Gitleaks, SBOM, vulnerability scans, DAST and tagged provenance | Local gates and documented public/manual workflows |

## Residual and accepted risks

- Authentication is password-only. There is no local MFA, identity-provider sign-in, breached-password
  screening, member session inventory or administrator session-revocation screen.
- Sessions use a 14-day sliding idle expiry, have no absolute lifetime, and have no configured
  maximum number of simultaneous sessions. Password changes and
  resets revoke sessions, but operators cannot revoke another member's active sessions through the
  product.
- Account Kit's operator commands are registered alongside the product's stricter owner-recovery
  path. The host operator already has database authority; some Kit commands do not create product
  audit rows. Treat command access as privileged host access and retain shell audit evidence.
- Authentication outcomes are not recorded in the product audit log. The application request log,
  when enabled, records method, route, status, latency and request metadata, not authentication
  outcomes.
- Password reset and invitation bearers occur in URL paths. Application route logging suppresses
  sensitive path values, but proxy, SMTP and mailbox access remain operator-controlled boundaries.
- SMTP delivery, mailbox security and retention, public TLS, encrypted host volumes, secret-manager
  use, clock synchronization, log retention and off-host collection require deployment evidence.
- The single-process SQLite service can still be denied service by sufficient network or
  tenant-valid load. Edge rate limiting, connection limits and resource monitoring remain operator
  controls.
- Host compromise is outside the containment boundary of application code. Protect the database,
  `APP_KEY`, mail credentials, backups and operator shell access accordingly.
