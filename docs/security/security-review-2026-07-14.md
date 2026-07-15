# Security review — 2026-07-14

## Executive conclusion

CapacityLens is suitable to open-source for continued community review and public CI, but this
review is not a claim of formal certification or that every self-hosted deployment is secure. The
application-level high-risk findings identified in this review have been remediated and covered by
tests. Remaining ASVS gaps are primarily higher-assurance capabilities outside this product's risk
target (phishing-resistant hardware authentication, adaptive device/location decisions and
HSM/full-memory encryption) or controls that only the deployer can
provide and verify (public TLS, encrypted volumes, secret management, clock synchronization,
off-host logs and retention).

The target is OWASP ASVS 5.0 Level 2 for a small multi-tenant scheduler, with Level 3 controls
assessed rather than ignored. The companion [complete ASVS ledger](owasp-asvs-5.0.0.md) accounts for
all 345 ASVS 5.0.0 requirements individually as Pass, Partial, Gap or Not Applicable. The threat
model and control inventories are maintained alongside it.

## Scope and method

Reviewed surfaces: React SPA, browser persistence/service worker, Fastify API, shared domain core,
Better Auth password/MFA/social/OIDC integration, membership/tenant enforcement, SQLite schema and
migrations, import/export, audit/logging, backups/restore, nginx, Docker/Compose, GitHub workflows,
dependency graph and repository history.

Method:

1. Manual data-flow, trust-boundary and authorization review against every ASVS 5.0.0 control.
2. Threat-model review using attacker, tenant, operator, browser, provider and supply-chain abuse
   cases.
3. Focused regression tests for each remediated control, followed by repository gates, cross-browser
   E2E, dependency/secret/container/DAST checks where locally available.
4. Mapping to OWASP Top 10 (2021), OWASP API Security Top 10 (2023), ASVS levels and OWASP SAMM.
5. Explicit separation of code guarantees, inherited framework/library guarantees and external
   operator controls.

This is a point-in-time source assessment, not a penetration test of a named production host. OIDC
provider behavior, TLS, volume encryption, host/container policy and logging infrastructure require
deployment-specific verification.

## Findings remediated

| ID | Original risk | Severity | Resolution |
|---|---|---:|---|
| CL-01 | Production password mode could operate without a second factor | Critical | Production requires TOTP MFA; enrollment blocks tenant data; recovery-code and subsequent challenge flows are integration-tested |
| CL-02 | Password policy/storage did not meet current full OWASP guidance | High | 15–128 characters, no composition rule, context-word rejection, HIBP k-anonymity check, versioned scrypt `N=2^17,r=8,p=1`, exact-byte verification and constant-time comparison |
| CL-03 | Session lifetime, visibility and containment were incomplete | High | Fixed 12-hour and 30-minute idle limits, 15-minute freshness for privileged actions, `__Host-` cookies, user session inventory/revocation, admin identity-global revocation with cross-account authority checks, reset invalidation |
| CL-04 | CORS alone was treated as the browser cross-site boundary | High | Root hook now rejects unsafe disallowed Origin or cross-site Fetch Metadata requests; exact origin CORS remains additive defense |
| CL-05 | Offline tenant snapshots were plaintext in browser storage | High | AES-256-GCM, non-extractable device key, random IV/AAD, tamper/expiry deletion, legacy plaintext wipe and viewer-only behavior |
| CL-06 | SSO-only production could silently inherit unknown single-factor assurance | High | Production requires explicit `CAPACITYLENS_SSO_MFA_ENFORCED=1` only after IdP MFA/recovery testing |
| CL-07 | Provider/password-check URLs allowed unsafe configuration or redirect behavior | High | Provider endpoints require credential-free absolute HTTPS (loopback HTTP only in development); HIBP endpoint is fixed, time-bounded, no-redirect and fail-closed |
| CL-08 | Security events were not a complete, separately forwardable stream | High | Typed security JSON plus mutation audit JSON; production requires audit and separate-forwarding acknowledgement; local sink degradation appears in health |
| CL-09 | Production could claim data protection without encrypted persistent storage | High | Startup refuses without an explicit encrypted database/audit/backup volume acknowledgement; docs state the flag is not the control itself |
| CL-10 | Database/audit/backup file modes inherited ambient host defaults | Medium | Process `0077` umask; `0600` database/WAL/SHM/audit/snapshot files; `0700` backup directory; tested |
| CL-11 | Deep health performed work proportional to tenant data and runtime integrity checks | Medium | Startup performs the full foreign-key check once; health uses constant `SELECT 1`, reports audit state and is rate limited |
| CL-12 | Sensitive API responses and token-bearing SPA routes had incomplete cache protection | Medium | All API responses are `no-store`; invite/reset routes are `no-store` and not access-logged; nonexistent file-like paths return 404 |
| CL-13 | Baseline browser policy lacked stronger production directives | Medium | Two-year HSTS including subdomains, CSP/frame isolation, no-referrer, no-sniff, COEP/COOP/CORP and restrictive Permissions Policy; runtime-injected styles moved to a static asset so style elements remain forbidden |
| CL-14 | Headless production bootstrap created a strong but non-expiring initial password | Medium | Headless/pinned bootstrap password paths are development-only; production must use setup-token signup where the owner chooses the final password |
| CL-15 | Release security checks did not cover the full public supply-chain path | High | Cross-browser E2E, full-history secret scan, dependency review, SBOM, CodeQL, Trivy, ZAP, pinned actions/images and tagged provenance |
| CL-16 | Production images carried unnecessary package-manager, frontend/test and network-client code, including newly vulnerable transitive/base packages | High | Dedicated pnpm deploy lock, explicit peer isolation and a Docker graph assertion reduce the API from 284 to 81 stored packages; npm/Corepack/Yarn and nginx curl/libcurl are removed; all three shipped images pass Trivy HIGH/CRITICAL scanning |
| CL-17 | Allocation validation treated an unresolved project on a project-bound activity as though the activity had no project | Medium | Missing and cross-account projects now fail closed at the shared write boundary; inactive and unchanged-reference behavior is mutation-tested with adversarial cases |
| CL-18 | The pinned package manager's dependency-audit client used registry endpoints that had been retired | Medium | pnpm 11 uses npm's supported bulk-advisory endpoint; the production-only audit is again fail-capable in local and hosted gates; clean installs explicitly allow only esbuild's reviewed lifecycle script |
| CL-19 | The packaged nginx→API connection used plaintext HTTP | Medium | A one-shot least-privilege initializer creates a per-install P-256 CA/API identity; Fastify serves HTTPS only, nginx verifies the CA and `api` name over TLS 1.2/1.3, production refuses missing identity paths and no HTTP fallback exists |
| CL-20 | CSP violations had no reporting destination | Medium | Legacy/current CSP reporting directives feed a public rate-limited 64 KiB endpoint that projects at most 20 origin/directive-only events into the separately forwarded security stream |
| CL-21 | Accepted sockets and memory-expensive password/security work lacked explicit process queues | High | API sockets are capped at 512; scrypt is capped at 2 active/16 queued and HIBP at 8 active/32 queued with timeout/fail-closed overflow; maxima and recovery behavior are inventoried |
| CL-22 | Packaged same-origin writes could be rejected when the redundant cross-origin allow-list was empty | Medium | The CSRF boundary now derives the exact public origin from the trusted proxy's overwritten scheme plus Host while still rejecting cross-site Fetch Metadata/disallowed origins; direct and proxied cases are regression-tested |
| CL-23 | Mutation tooling resolved a newly disclosed remotely triggerable `qs.stringify` denial of service | Medium | The workspace overrides Stryker's transitive dependency to patched `qs@6.15.2`; frozen install and a full 625-entry dependency audit pass with zero advisories |
| CL-24 | Unhandled process exceptions/rejections could lose structured security diagnostics before supervisor recovery | Medium | A process-wide last-resort handler records full local diagnostics plus a sanitized security event, drains in-flight work, exits non-zero and is restarted by the deployment supervisor rather than continuing potentially corrupt state |

## Residual risks and unmet controls

These are not concealed as “accepted passes.” Owners should reassess them when the deployment's
data sensitivity or user population changes.

| Residual | ASVS impact | Current treatment | Recommended trigger/action |
|---|---|---|---|
| TOTP is phishable and not hardware-backed | V6.3.3 L3 | Mandatory TOTP meets the intended L2 posture | Add WebAuthn/passkeys before high-assurance or targeted-adversary use |
| Legacy Better Auth password hashes retain the old work factor until credential rotation | V11.2.2/V11.4.2 | Verify-only compatibility; all new/reset/change hashes use `scrypt-v1` | Prompt or require password reset after upgrade if the old database may have been exposed |
| OIDC/social behavior is provider-dependent | V6.8.4, V7.1.3/V7.6.1 | HTTPS/identity/invite gates; SSO MFA acknowledgement; explicitly experimental | Provider-specific staging tests, claim assurance validation and coordinated logout before declaring stable |
| No adaptive IP/device/location risk engine or anomalous-login user notification | V6.3.5/V6.3.7, V8.2.4/V8.4.2 | MFA, throttling, typed events, fresh privileged actions and operator alerts | Add risk engine/notifications for a public multi-organization SaaS footprint |
| Reset/invite bearer values appear in one-time link paths | V14.2.1 | No-referrer, no-store, access-log suppression, short expiry, hashing/use/revocation | Move to a separate out-of-band code exchange if URL exposure is unacceptable |
| Browser offline data remains usable by compromised same-origin code | V14.3.3 | Opt-in, encrypted, non-extractable key, seven-day expiry, role filtered and read-only | Disable offline mode for high-sensitivity tenants; enforce managed-device controls |
| Public TLS certificate/cipher/revocation/ECH evidence remains outside the app | V12.1/V12.2 | Internal service TLS is verified with no plaintext fallback; public TLS is mandatory but supplied by the deployment edge | Capture scanner/proxy evidence for each deployment and reassess OCSP/ECH support with the edge provider |
| No HSM, full-memory encryption or PQC implementation | V11 L3 | Standard platform crypto, versioned formats and an automated crypto-discovery inventory | Revisit for regulated/high-assurance use or when NIST/platform guidance changes |
| Host encryption, secret manager, log collector, clocks, ACLs, retention and off-host backups are not observable by code | V11–V16 | Fail-closed acknowledgements plus operator checklist/runbook | Verify with infrastructure evidence before launch and at least annually |
| Single-process SQLite availability has a finite ceiling | V2.4/V13/V15/V16.5.4 | 512-socket ceiling, bounded scrypt/HIBP queues, throttling, bounded requests/imports, constant health, WAL/timeouts and fail-fast supervised recovery after an unhandled process fault | Add edge limits/monitoring; migrate architecture if measured load approaches limits |

## OWASP Top 10 (2021)

| Category | Assessment | Principal evidence or remaining issue |
|---|---|---|
| A01 Broken Access Control | Strong | Server-side membership/action checks, field projection, fresh privileged actions, cross-tenant tests; adaptive contextual authorization remains out of scope |
| A02 Cryptographic Failures | Strong application controls / deployment-dependent | scrypt, AES-GCM, CSPRNG tokens, verified internal TLS and TLS-only external URLs; disk/public-TLS/HSM remain operator controls |
| A03 Injection | Strong | React text rendering, no runtime eval/untrusted HTML, parameterized SQLite, explicit sanitisation/codecs, fixed/bounded regex and URLs |
| A04 Insecure Design | Strong | Threat model, standing invariants, closed signup, single-company default, fail-closed production guard, atomic import and explicit residual-risk ledger |
| A05 Security Misconfiguration | Strong defaults | Non-root/read-only/cap-drop containers, restrictive CSP/site-isolation/CORS/cache headers, hidden server version, production interlocks and no test reset; reverse proxy/TLS/collector still need correct deployment |
| A06 Vulnerable and Outdated Components | Automated | Minimal production graph, lockfile-recorded dependency patch, Dependabot, audit, dependency review, CodeQL, SBOM and Trivy; remediation timing is documented below |
| A07 Identification and Authentication Failures | Strong L2 | MFA, HIBP, scrypt, throttling, fixed/idle/revocable sessions and host-only cookies; no phishing-resistant factor or anomaly notification |
| A08 Software and Data Integrity Failures | Strong | Lockfile, pinned actions/base images, atomic database operations, authenticated offline encryption, SBOM/provenance and full-history secret scan |
| A09 Security Logging and Monitoring Failures | Strong app / operator-dependent | Typed auth/authz/CSRF/rate/error events and audit stream; collector alerts/retention must be verified externally |
| A10 Server-Side Request Forgery | Strong | No end-user URL fetch; fixed no-redirect HIBP URL; provider endpoints are operator-configured HTTPS URLs without credentials |

## OWASP API Security Top 10 (2023)

| Category | Assessment |
|---|---|
| API1 Broken Object Level Authorization | Account membership and object `accountId` are independently enforced on trusted server state; cross-account tests cover CRUD, import and session administration. |
| API2 Broken Authentication | Password/TOTP, generic failure, throttling, host-only cookies, fixed/idle sessions and immediate revocation are enforced; SSO assurance is an explicit external dependency. |
| API3 Broken Object Property Level Authorization | Explicit schemas/column codecs, protected-name field projection and preservation, and output minimisation defend both mass assignment and field disclosure. |
| API4 Unrestricted Resource Consumption | Body/record/batch/numeric caps, 512-socket ceiling, bounded scrypt/HIBP queues, per-IP throttling, timeouts and constant health exist; edge/global quotas remain operator controls. |
| API5 Broken Function Level Authorization | Central action/role matrix and server authorization precede mutations; UI visibility is never the authority. |
| API6 Unrestricted Access to Sensitive Business Flows | Setup, invitation, reset, membership, import, purge and account operations are gated, rate limited, fresh-session protected where privileged and audited. |
| API7 Server Side Request Forgery | End users cannot supply fetch destinations; configured identity endpoints are HTTPS validated and the fixed HIBP request refuses redirects. |
| API8 Security Misconfiguration | Production refuses unsafe auth/MFA/rate/audit/storage/logging states; headers, CORS, cache and containers are hardened. |
| API9 Improper Inventory Management | Entry-point, data, crypto, log and dependency inventories are versioned in `docs/security`; no undocumented versioned API exists. |
| API10 Unsafe Consumption of APIs | HIBP is time-bounded/no-redirect/fail-closed; IdP responses are delegated to maintained protocol libraries and provider support remains experimental. |

## OWASP SAMM view

| Business function | Current maturity evidence | Next maturity step |
|---|---|---|
| Governance | Security policy, full ASVS ledger, data/crypto/log/third-party inventory, public disclosure channel | Define deployment-specific risk owner, metrics and annual policy/exception review |
| Design | Threat model, architecture/tenant invariants, privacy and defensive-coding standards | Add automated abuse-case review to major architecture changes and provider-specific assurance profiles |
| Implementation | Shared validation core, code review gates, lockfile, secret scan, SAST, dependency review, SBOM/provenance | Add signed container publication and enforced branch protections when public |
| Verification | Unit/integration/mutation/cross-browser E2E, authorization regressions, restore drill, container scan and ZAP; survivor triage is recorded in the [mutation review](mutation-review-2026-07-15.md) | Commission an independent authenticated penetration test against the release deployment |
| Operations | Production guard, typed forwarding, restrictive files/containers, backup and incident runbooks | Exercise incident/log/restore procedures with the real collector, IdP and encrypted backup destination |

## Maintenance and remediation policy

- Critical actively exploitable runtime vulnerability: contain immediately; patch or disable the
  affected path within 24 hours.
- High runtime vulnerability: patch within 7 days. Medium: 30 days. Low: 90 days or document why it
  is not reachable/impactful.
- Supported runtime/dependency updates without a known vulnerability: review monthly; do not let a
  runtime or security-critical library leave upstream support.
- Better Auth/provider protocol code, import/migration, cryptography, backup/restore, service worker,
  shell/process execution in development scripts and release workflows are “risky/dangerous” areas:
  require focused tests and security review when changed.
- Rotate `BETTER_AUTH_SECRET` and provider credentials after suspected exposure, staff/access change
  or provider requirement, and at the operator's documented interval. Rotation of
  `BETTER_AUTH_SECRET` invalidates sessions. TLS/storage/backup keys follow the platform key policy.
- Review this report, threat model, inventories, action/image pins and ASVS release at least annually
  and after a material auth, tenancy, deployment or data-classification change.

## Verification record

Verification completed on 2026-07-15 with the repository's pinned Node 24 runtime:

| Verification | Result |
|---|---|
| `pnpm run gate:server` | Pass: TypeScript, ESLint and 570 server tests across 37 files |
| `pnpm run gate` | Pass: 1,617 tests across 101 files; 84.13% statements, 78.22% branches, 86.33% functions and 86.42% lines; production build and bundle budget pass |
| `pnpm run e2e:all` | Pass: 525 tests—185 Chromium/database/auth, 170 isolated WebKit/Safari and 170 isolated Firefox/Gecko |
| `pnpm run mutation` | Pass: 2,988 mutants; 2,763 killed, 11 timed out, 177 survived, 37 uncovered and 0 errors; 92.84% total / 94.00% covered score against an 85% break threshold |
| `pnpm audit` | Pass: no known vulnerabilities across all 625 production, development and optional dependency entries; GHSA-q8mj-m7cp-5q26 is fixed at `qs@6.15.2` |
| `CI=1 pnpm install --frozen-lockfile` | Pass: clean install from the frozen lockfile; pnpm's fail-closed lifecycle policy permits only esbuild's reviewed install script |
| Gitleaks 8.30.1 | Pass: all 16 Git commits and the final worktree; no leaks found |
| Docker production build/guard/smoke | Pass: dedicated 81-package API runtime graph, verified internal TLS with no plaintext fallback, production interlocks, loopback-only public edge, health/database/audit status, security headers, same-origin reporting and cross-site unsafe-request rejection |
| Trivy 0.72.0 | Pass: exact final API, web and internal-TLS initializer image archives contain no fixed HIGH or CRITICAL vulnerabilities |
| OWASP ZAP pinned baseline | Pass: 0 failures, 0 warnings, 4 reviewed informational classes and 63 passing checks |
| `actionlint` 1.7.12 | Pass: all GitHub workflow files |
| ASVS ledger reconciliation | Pass: all 345 official v5.0.0 IDs appear exactly once—201 Pass, 46 Partial, 7 Gap and 91 N/A |
| `git diff --check` | Pass |

The four ZAP informational classes are suspicious strings in public/minified HTML, intentional
non-storable shell responses, the expected modern-SPA classification and the deliberately retained
legacy `report-uri` directive beside `report-to` for browser interoperability. They are downgraded
to INFO—not ignored—in `.zap/rules.tsv`; every warning or failure remains build-failing.

Hosted CodeQL, dependency review, SBOM generation and tagged provenance are configured but cannot
be claimed as executed by this local review. Their first public GitHub run is a release gate, and a
real deployment still needs the operator evidence and independent testing identified above.
