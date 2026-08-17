---
title: Security review — 2026-08-18
description: An alpha4 source-code security reassessment against OWASP ASVS 5.0.0, the OWASP Top 10 and the API Security Top 10.
---

# Security review — 2026-08-18

## Executive conclusion

CapacityLens 0.55.0-alpha.4 remains suitable for continued community review and public CI. The
alpha4 delta review found no unresolved Critical, High or Medium application vulnerability. It did
find that the dated assurance documents had fallen behind implemented controls, including the
bounded import worker pool, stricter CSP-report limit, encrypted OAuth tokens, explicit federated
identity linking and the SSO cutover/recovery paths. This review refreshes that evidence rather than
turning documentation drift into an unsupported security claim.

The target remains OWASP ASVS 5.0 Level 2 when optional hardening is enabled. Password-only
deployments remain below the strict Level 2 authentication target because required MFA is optional.
Hardware-backed authentication, adaptive device/location decisions, HSM or full-memory encryption,
and deployer-controlled TLS, storage and monitoring evidence remain outside the application
guarantee. This is a source/configuration assessment, not a penetration test or certification.

## Scope and method

This review reassessed the complete current application and the security-relevant delta since the
[2026-07-14 review](/security/security-review-2026-07-14): React and offline browser state, the
Fastify/SQLite API, shared validation, account and identity ports, password/MFA and strict OIDC,
SSO cutover and stopped-server recovery, tenant authorization, imports and worker concurrency,
audit durability, backups, nginx, Docker, workflows and the dependency graph.

The method was:

1. Reconcile the threat model and control inventories with the current source and configuration.
2. Review authentication, tenancy, destructive operations, concurrency, cryptography, deployment
   and supply-chain changes since the previous assessment.
3. Reconcile every ASVS 5.0.0 identifier and update evidence or status where the implementation
   changed.
4. Inspect the current Node 24 gate, account-boundary, migration, crash-durability, cross-browser,
   strict-OIDC, CodeQL, dependency, secret, container and OWASP ZAP evidence.
5. Keep application guarantees separate from library guarantees and operator controls.

## Delta findings and treatment

The original CL-01–CL-24 findings and their treatments remain recorded in the
[previous review](/security/security-review-2026-07-14). The alpha4 reassessment adds these findings.

| ID    | Finding                                                                                                               | Severity | Treatment                                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-25 | The documented 30-minute inactivity limit had been ineffective because the session timestamp representation differed |     High | Fixed before alpha4: the server normalizes the real stored representation, uses compare-and-swap touch/delete operations, expires at the exact boundary and retains the independent 12-hour absolute limit                           |
| CL-26 | Strict-OIDC discovery could accept a provider-advertised server endpoint on a private or reserved network             |     High | Fixed before alpha4: discovered endpoints are resolved and classified before use; public issuers cannot redirect server-side token, JWKS or user-info traffic to private/reserved networks, and provider HTTP responses stay bounded |
| CL-27 | OAuth access/refresh tokens were stored without application-layer encryption and implicit linking was enabled         |     High | Fixed before alpha4: Better Auth encrypts provider tokens with the application secret; implicit linking is disabled; explicit links require verified matching email and durable admission evidence                                 |
| CL-28 | The security documents omitted or misstated several implemented alpha4 limits and controls                            |      Low | Resolved by this reassessment: the threat model, inventories and ASVS ledger now describe the import worker pool, CSP limit, SSO cutover/recovery, token encryption, current secret allowlist and concurrency status                 |

No additional unresolved finding was identified in the reviewed scope.

## Material changes revalidated

- The provider-neutral account boundary now owns account, identity, membership, invitation,
  session, recovery and erasure flows through explicit ports and policy checks. The server still
  independently authorizes each tenant operation; architecture and conformance tests prevent route
  code from bypassing the boundary.
- Strict OIDC now verifies discovered endpoints before secret use, validates asymmetric ID tokens,
  requires verified email for admission/linking, disables implicit linking and records durable
  provider/subject observations. The SSO-only cutover refuses startup until every live membership
  is ready, then atomically revokes incompatible state and records activation.
- Sole-Owner password recovery is a stopped-server operator ceremony. It requires an exclusive
  SQLite lock and a unique eligible identity, mints the normal single-use reset flow, revokes a
  partially issued ceremony on failure and records a token-free audit event.
- Destructive imports remain Owner-only and atomic. CPU-heavy preparation uses a process-wide
  two-active/eight-queued worker bound with a five-second queue deadline and request cancellation;
  the transaction rechecks a fingerprint of the exact tenant slice so concurrent writes conflict
  instead of being overwritten.
- Product writes commit a data-minimised audit event to the SQLite outbox with the mutation. Bounded
  recovery preserves malformed head rows for investigation, progressive draining avoids starving
  the event loop, and every delivery is flushed before deletion.
- Offline snapshots remain encrypted, opt-in and read-only. The seven-day retention boundary is
  now swept on every cache connection as well as normal reads, preventing an unopened stale record
  from surviving indefinitely.

## OWASP mapping

The refreshed [ASVS 5.0.0 ledger](/security/owasp-asvs-5.0.0) accounts for all 345 requirements:
**200 Pass, 48 Partial, 7 Gap and 90 Not Applicable**. The only status movement is V15.4.4 from Not
Applicable to Pass because alpha4 now has a bounded FIFO import-worker pool with queue deadlines,
cancellation and starvation tests. Other changes strengthen evidence without changing status.

The OWASP Top 10 and API Security Top 10 mapping remains materially unchanged:

- Broken access control and BOLA are constrained by server-side membership/action/field policy,
  tenant identifiers, SQLite constraints and cross-account tests.
- Cryptographic failures are constrained by versioned scrypt, authenticated offline encryption,
  encrypted OAuth tokens, hashed bearer lookup, TLS verification and the gate-enforced inventory.
- Injection, insecure design and unsafe API consumption are constrained by structured parsing,
  allowlisted fields, parameterized SQLite, explicit trust boundaries and bounded no-redirect
  provider calls.
- Misconfiguration and vulnerable components are constrained by production startup checks, pinned
  build inputs, dependency review, CodeQL, SBOM, secret scanning, container scans and ZAP.
- Logging and monitoring controls include transactional mutation audit, typed security events and
  unattended security-workflow failure reporting; collector retention and alerting remain operator
  responsibilities.

## Residual risks

The previous review's residual risks remain. In particular:

- Required TOTP is optional and phishable; passkeys or another phishing-resistant factor are still
  needed before high-assurance use.
- Provider disablement and upstream logout do not revoke already-issued local sessions. Operators
  must use local revocation during an incident; back-channel logout remains absent.
- SSO cutover deliberately leaves password credentials dormant for the documented mixed-mode
  rollback. Host/database compromise and operator misuse remain outside in-process containment.
- The stopped-server Owner recovery command is intentional operator authority. Protecting host and
  database access is therefore part of the authentication boundary.
- Public TLS, encrypted volumes, secret management, time synchronization, immutable/off-host logs,
  backup retention and alerting require deployment evidence.
- An unlocked or compromised application origin can use its non-extractable offline key, and a
  single-process SQLite service retains a finite availability ceiling.

## Verification record

Verification applies to `c49ff283951f5735b9239971dd005d42e78a0481`, which contains
0.55.0-alpha.4 plus documentation-only installation-route separation.

| Verification | Result |
| ------------ | ------ |
| Application gate | Pass: typecheck, ESLint, 3,382 tests across 191 files, coverage thresholds and production build/bundle checks |
| Server gate | Pass: typecheck, ESLint, all four unit shards, 311 account-boundary conformance tests, released v7→v34 migration rehearsal and credential-onboarding crash durability |
| Cross-browser and identity E2E | Pass: 251 Chromium/database/auth, 227 Firefox, 227 WebKit and five strict-OIDC/Dex scenarios |
| CodeQL and dependency review | Pass on current `main` |
| Secret scan and SBOM | Pass: no full-history leaks; source SBOM generated |
| Container scans | Pass: zero fixed High or Critical findings in the API, web and internal-TLS initializer images |
| OWASP ZAP | Pass: hardened posture on the reviewed commit; default posture manually rerun on `5f07b7f`, before only documentation changed—23 URLs, 63 checks, zero failures, zero warnings and four reviewed ignores per profile |
| ASVS reconciliation | Pass: every official ASVS 5.0.0 identifier appears exactly once; totals are 200 Pass, 48 Partial, 7 Gap and 90 N/A |

The default-posture ZAP run is informational because optional hardening is deliberately not forced.
The four ignored classes retain their reviewed rationale in `.zap/rules.tsv`; new warnings and
failures remain visible, and the hardened profile remains blocking.
