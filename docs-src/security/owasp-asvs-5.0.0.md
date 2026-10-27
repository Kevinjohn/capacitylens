---
title: OWASP ASVS 5.0.0 complete control ledger
description: ASVS 5.0.0 control ledger assessed in 2026 with a 2026-10-26 Account Kit authentication update.
---

# OWASP ASVS 5.0.0 complete control ledger

Original assessment date: 2026-08-18. Authentication and related controls amended: 2026-10-26, after the Account Kit cutover. Every Level 1–3 requirement is assessed. Password-only deployments do not meet the Level 2 multi-factor requirement.
Baseline: OWASP Application Security Verification Standard 5.0.0 (May 2025), 345 requirements.

This ledger is an evidence-based source/configuration review, not an OWASP certification. It uses:

- **Pass** — implemented or deliberately avoided, with repository evidence and tests where practical;
- **Partial** — meaningful controls exist, but a clause, deployment proof or higher-assurance aspect is incomplete;
- **Gap** — applicable requirement is not implemented;
- **N/A** — the governed technology/function does not exist in CapacityLens.

An inherited library/framework control is only marked Pass where the application constrains its use
and the behavior is covered by configuration/tests or the maintained library contract. External
TLS, disks, collectors, secret stores and external authentication policy cannot become Pass merely because
an environment acknowledgement is set; those stay Partial where deployment evidence is required.
Requirement descriptions are not reproduced here; use the [official ASVS 5.0.0 release](https://github.com/OWASP/ASVS/tree/v5.0.0_release) alongside these IDs.

Original 2026-08-18 totals: **200 Pass, 48 Partial, 7 Gap and 90 N/A = 345**. Following the 2026-10-09 local MFA removal, the 2026-10-21 retirement of the automated cryptographic path check, and this 2026-10-26 authentication amendment, the current rows total **152 Pass, 58 Partial, 16 Gap and 119 N/A = 345**. These are not a score or certification percentage.

## V1 Encoding and sanitization

| Section                    | Evidence summary                                                                                            | Pass                                   | Partial | Gap | N/A                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | --- | ---------------------------------------------------------------- |
| V1.1 Architecture          | Adonis BodyParser owns parsing; shared sanitisation precedes domain use; React/JSON perform contextual output encoding | V1.1.2 | V1.1.1 | — | — |
| V1.2 Injection prevention  | React text nodes, encoded URL components, structured JSON, parameterized SQLite, fixed/bounded regex        | V1.2.1, V1.2.2, V1.2.3, V1.2.4, V1.2.9 | —       | —   | V1.2.5, V1.2.6, V1.2.7, V1.2.8, V1.2.10                          |
| V1.3 Sanitization          | No eval; context-specific codecs/lengths; operator-only HTTPS URL allow-list; bounded fixed regex; account email uses structured SMTP transport fields | V1.3.2, V1.3.3, V1.3.6, V1.3.12 | V1.3.11 | — | V1.3.1, V1.3.4, V1.3.5, V1.3.7, V1.3.8, V1.3.9, V1.3.10 |
| V1.4 Memory/numeric safety | Memory-safe JS/TS runtime, bounded integer parsers and explicit shutdown/resource release                   | V1.4.1, V1.4.2, V1.4.3                 | —       | —   | —                                                                |
| V1.5 Safe parsing          | Typed JSON/object allow-listing; Node URL parser; no XML                                                    | V1.5.2                                 | V1.5.3  | —   | V1.5.1                                                           |

## V2 Validation and business logic

| Section                 | Evidence summary                                                                                        | Pass                   | Partial | Gap | N/A            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- | ------- | --- | -------------- |
| V2.1 Documentation      | `AGENTS.md`, `DECISIONS.md`, domain invariants and control inventory define shape/context/limits | V2.1.1, V2.1.2, V2.1.3 | —       | —   | —              |
| V2.2 Enforcement        | Server/domain validation is authoritative; related entity/account/date/activity rules checked           | V2.2.1, V2.2.2, V2.2.3 | —       | —   | —              |
| V2.3 Flows/transactions | Setup/invite/link/cutover order, SQLite transactions, sync provenance, stale-import checks and atomic replacement | V2.3.1, V2.3.2, V2.3.3 | —       | —   | V2.3.4, V2.3.5 |
| V2.4 Anti-automation    | API/health throttling and request/import/batch bounds                                                   | V2.4.1                 | —       | —   | V2.4.2         |

## V3 Web frontend security

| Section                    | Evidence summary                                                                                                                                                                           | Pass                                                   | Partial        | Gap | N/A            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------- | --- | -------------- |
| V3.1 Browser feature model | Evergreen-browser cross-browser suite and security headers; no full incompatible-browser block                                                                                             | —                                                      | V3.1.1         | —   | —              |
| V3.2 Rendering context     | JSON MIME/nosniff/CORP plus React text rendering and TypeScript module scope                                                                                                               | V3.2.1, V3.2.2, V3.2.3                                 | —              | —   | —              |
| V3.3 Cookies               | HTTPS emits Secure, Path=/, domain-free `__Host-` cookies; HTTP loopback uses development names; SameSite=Lax, HttpOnly and bounded cookies                                                | V3.3.1, V3.3.2, V3.3.3, V3.3.4, V3.3.5                 | —              | —   | —              |
| V3.4 Browser headers       | Host-only one-year HSTS for an HTTPS public URL, exact CORS, one application CSP, nosniff, no-referrer, frame denial and COEP/COOP/CORP | V3.4.1, V3.4.2, V3.4.4, V3.4.5, V3.4.6, V3.4.7, V3.4.8 | V3.4.3         | —   | —              |
| V3.5 Cross-origin controls | Unsafe Origin/Fetch-Metadata rejection, correct methods, no JSONP/script data, same-origin CORP                                                                                            | V3.5.1, V3.5.2, V3.5.3, V3.5.6, V3.5.7, V3.5.8         | —              | —   | V3.5.4, V3.5.5 |
| V3.6 External assets       | Runtime JS/CSS/fonts are self-hosted; no CDN runtime dependency                                                                                                                            | V3.6.1                                                 | —              | —   | —              |
| V3.7 Client behavior       | Supported web platform; preload and incompatible-browser behavior remain deployment-dependent | V3.7.1, V3.7.2, V3.7.3 | V3.7.4, V3.7.5 | — | — |

## V4 API and web service

| Section              | Evidence summary                                                                                                    | Pass                   | Partial                        | Gap | N/A                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ | --- | ------------------------------ |
| V4.1 HTTP use        | Correct content types and explicit methods; deployed TLS behavior needs operator evidence | V4.1.1, V4.1.4 | V4.1.2, V4.1.3 | — | V4.1.5 |
| V4.2 Message framing | Adonis/Node framing; deployed proxy and outbound URI/header compatibility need evidence | — | V4.2.1, V4.2.2, V4.2.3, V4.2.4, V4.2.5 | — | — |
| V4.3 GraphQL         | No GraphQL endpoint                                                                                                 | —                      | —                              | —   | V4.3.1, V4.3.2                 |
| V4.4 WebSocket       | No WebSocket endpoint                                                                                               | —                      | —                              | —   | V4.4.1, V4.4.2, V4.4.3, V4.4.4 |

## V5 File handling

| Section               | Evidence summary                                                                                               | Pass           | Partial | Gap | N/A                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- | ------- | --- | ------------------------------ |
| V5.1 Documentation    | JSON import is the sole file-like input; Adonis BodyParser defaults apply                                     | V5.1.1         | —       | —   | —                              |
| V5.2 Uploaded content | JSON content parsed by Adonis BodyParser and checked for valid table/row structure; extension/content agreement is not enforced | V5.2.1 | V5.2.2 | — | V5.2.3, V5.2.4, V5.2.5, V5.2.6 |
| V5.3 Storage/path     | Server data/audit/backup paths are operator configuration, not user filenames; no public uploaded code/archive | V5.3.2         | —       | —   | V5.3.1, V5.3.3                 |
| V5.4 Downloads        | Export is a browser Blob with a fixed anchor download name, not an HTTP attachment response | V5.4.2 | — | — | V5.4.1, V5.4.3 |

## V6 Authentication

| Section                          | Evidence summary                                                                                                                                                                                                         | Pass                                                                                     | Partial | Gap            | N/A                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------- | -------------- | ------------------------------ |
| V6.1 Documentation               | Password pathways, throttling, password length and the lack of local MFA are documented; no documented context-specific word list | V6.1.1, V6.1.3 | — | V6.1.2 | — |
| V6.2 Passwords                   | 15–128, change/current-password flow, no composition rule, paste/managers, exact bytes and no periodic expiry; no context-word enforcement, common-password list or breached-password screening | V6.2.1, V6.2.2, V6.2.3, V6.2.5, V6.2.6, V6.2.7, V6.2.8, V6.2.9, V6.2.10 | — | V6.2.4, V6.2.11, V6.2.12 | — |
| V6.3 Authentication controls     | API throttling and no default account; failed-challenge indistinguishability across responses and timing remains unproved | V6.3.1, V6.3.2, V6.3.4, V6.3.6 | V6.3.7, V6.3.8 | V6.3.3, V6.3.5 | — |
| V6.4 Recovery                    | Production setup avoids initial passwords; password reset revokes sessions; stopped-server recovery issues a reset link only for an eligible sole Owner; no product-admin reset flow | V6.4.1, V6.4.2, V6.4.3 | V6.4.6 | — | V6.4.4, V6.4.5 |
| V6.5 Factor properties | No local authenticator, TOTP enrolment or recovery-code flow | — | — | — | V6.5.1, V6.5.2, V6.5.3, V6.5.4, V6.5.5, V6.5.6, V6.5.7, V6.5.8 |
| V6.6 Out-of-band/PSTN            | No SMS, phone, email-code or push factor                                                                                                                                                                                 | —                                                                                        | —       | —              | V6.6.1, V6.6.2, V6.6.3, V6.6.4 |
| V6.7 Cryptographic authenticator | No hardware cryptographic authenticator                                                                                                                                                                                  | —                                                                                        | —       | —              | V6.7.1, V6.7.2                 |
| V6.8 Federated identity          | CapacityLens has no identity-provider sign-in or federation function | — | — | — | V6.8.1, V6.8.2, V6.8.3, V6.8.4 |

## V7 Session management

| Section                          | Evidence summary                                                                                                                    | Pass                                   | Partial | Gap | N/A |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | --- | --- |
| V7.1 Documentation               | The 14-day inactivity timeout and unlimited concurrent sessions are documented; there is no absolute session lifetime | V7.1.2 | V7.1.1 | — | V7.1.3 |
| V7.2 Token creation/verification | Backend stateful CSPRNG reference sessions; new token on authentication                                                             | V7.2.1, V7.2.2, V7.2.3, V7.2.4         | —       | —   | —   |
| V7.3 Timeouts                    | Server-enforced 14-day sliding inactivity expiry; no absolute maximum lifetime | V7.3.1 | — | V7.3.2 | — |
| V7.4 Termination                 | Logout, expiry, account deletion and password change/reset invalidate sessions; no administrator session-revocation control | V7.4.1, V7.4.2, V7.4.3, V7.4.4 | — | V7.4.5 | — |
| V7.5 Reauthentication | Password confirmation protects sensitive operations; action proofs are single-use and bound to the user, session, company, action and intent | V7.5.1, V7.5.3 | — | V7.5.2 | — |
| V7.6 Federation                  | CapacityLens has no identity-provider session federation; session creation follows explicit user sign-in | V7.6.2 | — | — | V7.6.1 |

## V8 Authorization

| Section                      | Evidence summary                                                                                                                                                                           | Pass                           | Partial | Gap    | N/A |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------- | ------ | --- |
| V8.1 Documentation           | Function/data/field/action rules and per-action password proofs are documented | V8.1.1, V8.1.2, V8.1.3, V8.1.4 | — | — | — |
| V8.2 Enforcement             | Central role/action, account/object/parent-reference and field rules; project-bound writes fail closed when the parent cannot be resolved in-tenant; no adaptive environment/device engine | V8.2.1, V8.2.2, V8.2.3         | —       | V8.2.4 | —   |
| V8.3 Trusted layer/immediacy | Server-side DB membership on every operation; changes/revocations immediate; no privilege-bearing intermediary                                                                             | V8.3.1, V8.3.2, V8.3.3         | —       | —      | —   |
| V8.4 Multi-tenancy/admin | Independent cross-tenant enforcement; specified sensitive actions require an action-bound password proof; no local MFA or continuous device/risk assessment | V8.4.1 | V8.4.2 | — | — |

## V9 Self-contained tokens

| Section        | Evidence summary                                                                                                        | Pass                   | Partial | Gap | N/A    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------- | --- | ------ |
| V9.1 Integrity | CapacityLens does not use self-contained application tokens | — | — | — | V9.1.1, V9.1.2, V9.1.3 |
| V9.2 Claims    | CapacityLens does not issue or accept self-contained access tokens | — | — | — | V9.2.1, V9.2.2, V9.2.3, V9.2.4 |

## V10 OAuth and OIDC

| Section                    | Evidence summary                                                                                             | Pass                               | Partial | Gap | N/A                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| V10.1 Token/client binding | CapacityLens has no OAuth client flow | — | — | — | V10.1.1, V10.1.2 |
| V10.2 Client flows         | CapacityLens has no OAuth client flow | — | — | — | V10.2.1, V10.2.2, V10.2.3 |
| V10.3 Resource server      | CapacityLens does not accept OAuth access tokens as an API resource server                                   | —                                  | —       | —   | V10.3.1, V10.3.2, V10.3.3, V10.3.4, V10.3.5                                                                                                           |
| V10.4 Authorization server | CapacityLens is not an OAuth authorization server                                                            | —                                  | —       | —   | V10.4.1, V10.4.2, V10.4.3, V10.4.4, V10.4.5, V10.4.6, V10.4.7, V10.4.8, V10.4.9, V10.4.10, V10.4.11, V10.4.12, V10.4.13, V10.4.14, V10.4.15, V10.4.16 |
| V10.5 OIDC relying party   | CapacityLens has no OpenID Connect relying-party flow | — | — | — | V10.5.1, V10.5.2, V10.5.3, V10.5.4, V10.5.5 |
| V10.6 OpenID Provider      | CapacityLens is not an OpenID Provider                                                                       | —                                  | —       | —   | V10.6.1, V10.6.2                                                                                                                                      |
| V10.7 Consent              | CapacityLens is not an authorization server managing third-party grants                                      | —                                  | —       | —   | V10.7.1, V10.7.2, V10.7.3                                                                                                                             |

## V11 Cryptography

| Section                       | Evidence summary                                                                                                                                                    | Pass                               | Partial          | Gap     | N/A     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------- | ------- | ------- |
| V11.1 Inventory/lifecycle     | Repository crypto inventory reviewed by hand, without automated implementation-path discovery; deployment key rotation/PQC migration remain operator/planning work | V11.1.2                            | V11.1.1, V11.1.3, V11.1.4 | —       | —       |
| V11.2 Design/implementation   | Node/Web Crypto, Account Kit and Adonis primitives, ≥128-bit random tokens and fail-closed errors; password scrypt parameters are documented separately | V11.2.1, V11.2.3, V11.2.5 | V11.2.2, V11.2.4 | — | — |
| V11.3 Symmetric encryption    | `config/encryption.ts` declares AES-256-GCM with `APP_KEY`, but current call sites and protected stored data are not established | — | V11.3.1, V11.3.2, V11.3.3, V11.3.4 | — | V11.3.5 |
| V11.4 Hash/KDF                | SHA-256 token and intent digests; password verifier uses OWASP-minimum scrypt `N=2^14`, `r=8`, `p=5`; no password-derived application encryption key | V11.4.1, V11.4.2, V11.4.3 | — | — | V11.4.4 |
| V11.5 Randomness              | Platform CSPRNG with ≥128-bit security for tokens/keys and OS heavy-demand behavior                                                                                 | V11.5.1, V11.5.2                   | —                | —       | —       |
| V11.6 Key generation/exchange | Platform-approved generation and TLS exchange primitives                                                                                                            | V11.6.1, V11.6.2                   | —                | —       | —       |
| V11.7 In-use data             | Data minimisation/short-lived values exist; no full-memory encryption and necessary plaintext exists while processing                                               | —                                  | V11.7.2          | V11.7.1 | —       |

## V12 Secure communication

| Section                 | Evidence summary                                                                                                                                                                                                   | Pass    | Partial          | Gap              | N/A              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------- | ---------------- | ---------------- |
| V12.1 TLS configuration | Public TLS/version/ciphers are proxy/operator evidence; no mTLS client; OCSP/ECH not supplied by app                                                                                                               | —       | V12.1.1, V12.1.2 | V12.1.4, V12.1.5 | V12.1.3          |
| V12.2 Public services   | Documentation mandates public TLS/trusted certificates, but source review cannot verify a deployed endpoint                                                                                                        | —       | V12.2.1, V12.2.2 | —                | —                |
| V12.3 Other connections | Outbound HTTPS validates certificates; packaged nginx verifies a per-install CA/service identity over TLS 1.2/1.3, while same-host bare-metal HTTP is permitted; public monitoring/operator protocols are external | V12.3.2 | V12.3.1, V12.3.3 | —                | V12.3.4, V12.3.5 |

## V13 Configuration

| Section                       | Evidence summary                                                                                                                                                              | Pass                                                          | Partial                   | Gap     | N/A     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- | ------- | ------- |
| V13.1 Communication/resources | Communication inventory defines socket/service/work maxima, queue/timeout/refusal behavior and recovery; deployment certificate/credential rotation remains operator-specific | V13.1.1, V13.1.2                                              | V13.1.3, V13.1.4          | —       | —       |
| V13.2 Backend communication   | Unprivileged components, no defaults, fixed/configured outbound endpoints; network egress and connection policy require deployment controls                                   | V13.2.2, V13.2.3                                              | V13.2.4, V13.2.5, V13.2.6 | —       | V13.2.1 |
| V13.3 Secret management       | Docs require secret manager/least privilege/rotation; env delivery is supported, not a vault/HSM or enforced expiry                                                           | —                                                             | V13.3.1, V13.3.2, V13.3.4 | V13.3.3 | —       |
| V13.4 Production exposure     | `.dockerignore`, production-only dependencies, no debug/reset, no listing/TRACE, intentional health, no detailed backend versions, exact static-file handling                 | V13.4.1, V13.4.2, V13.4.3, V13.4.4, V13.4.5, V13.4.6, V13.4.7 | —                         | —       | —       |

## V14 Data protection

| Section                      | Evidence summary                                                                                                                        | Pass                               | Partial                   | Gap | N/A     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------- | --- | ------- |
| V14.1 Classification         | Privacy/control inventories identify data classes and application/operator protections                                                  | V14.1.1, V14.1.2                   | —                         | —   | —       |
| V14.2 Server-side protection | API no-store, no trackers, projection/minimisation and 404 file behavior; link tokens, deployment storage and retention remain partial  | V14.2.2, V14.2.3, V14.2.5, V14.2.6 | V14.2.1, V14.2.4, V14.2.7 | —   | V14.2.8 |
| V14.3 Browser data           | API no-store; scheduling and identity snapshots are not persisted in the browser; no universal Clear-Site-Data | V14.3.2                            | V14.3.1, V14.3.3          | —   | —       |

## V15 Secure coding and architecture

| Section                        | Evidence summary                                                                                                                        | Pass                                                          | Partial | Gap | N/A                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- | --- | ------------------------- |
| V15.1 Documentation/inventory  | Remediation policy, SBOM/third parties, expensive/risky/dangerous function inventory                                                    | V15.1.1, V15.1.2, V15.1.3, V15.1.4, V15.1.5                   | —       | —   | —                         |
| V15.2 Components/resources     | Audits/scans, bounded heavy paths, minimal production graph with leak assertion, lockfile-recorded patch, non-root read-only containers | V15.2.1, V15.2.2, V15.2.3, V15.2.4, V15.2.5                   | —       | —   | —                         |
| V15.3 Defensive implementation | Output projection, no-redirect outbound call, allowlisted fields, trusted proxy, strict TS/types/prototype/parameter handling           | V15.3.1, V15.3.2, V15.3.3, V15.3.4, V15.3.5, V15.3.6, V15.3.7 | —       | —   | —                         |
| V15.4 Concurrency              | SQLite transaction checks and single-process ownership; no import worker threads or separate worker lock lifecycle; async scrypt uses the shared libuv threadpool and no fairness guard was identified | V15.4.2 | V15.4.4 | — | V15.4.1, V15.4.3 |

## V16 Security logging and error handling

| Section                | Evidence summary                                                                                                                                                                                                                                                                        | Pass                               | Partial          | Gap | N/A |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------- | --- | --- |
| V16.1 Inventory        | Layer/event/format/destination/sensitivity inventory exists; actual access control and retention need operator evidence | — | V16.1.1 | — | — |
| V16.2 Log content      | UTC ISO metadata, documented JSON streams and credential/body redaction; clock synchronization and deployed processor correlation need evidence | V16.2.1, V16.2.3, V16.2.5 | V16.2.2, V16.2.4 | — | — |
| V16.3 Security events  | Optional request logging records event, method, route, status, outcome and correlation ID; expected authority/proof/validation/Kit failures are not individually logged, and no auth-specific success, failure or throttling event is written | V16.3.4 | V16.3.2, V16.3.3 | V16.3.1 | — |
| V16.4 Log protection   | Structured serialization prevents injection; audit rows are in SQLite; external forwarding is not provided and deployment access controls require operator evidence | V16.4.1 | V16.4.2, V16.4.3 | — | — |
| V16.5 Failure handling | Generic responses, fail-closed external/control failures, transaction rollback and startup error handling; no process-wide last-resort handler for unhandled exceptions was identified | V16.5.1, V16.5.2, V16.5.3 | — | V16.5.4 | — |

## V17 WebRTC

| Section         | Evidence summary                       | Pass | Partial | Gap | N/A                                                                    |
| --------------- | -------------------------------------- | ---- | ------- | --- | ---------------------------------------------------------------------- |
| V17.1 TURN      | No WebRTC/TURN                         | —    | —       | —   | V17.1.1, V17.1.2                                                       |
| V17.2 Media     | No DTLS/SRTP/media server or recording | —    | —       | —   | V17.2.1, V17.2.2, V17.2.3, V17.2.4, V17.2.5, V17.2.6, V17.2.7, V17.2.8 |
| V17.3 Signaling | No WebRTC signaling server             | —    | —       | —   | V17.3.1, V17.3.2                                                       |

## Account Kit authentication amendment (2026-10-26)

The current authentication classifications above were checked against the password-only routes,
Account Kit configuration and vendored Kit behavior. Dated security-review documents retain their
original evidence; these current classifications supersede earlier authentication claims. The
changed rows are supported by the following source evidence:

| Controls | Current evidence |
| --- | --- |
| V6.1.2, V6.2.11 | No documented context-specific word list or enforcement against such words was found; current password configuration establishes length only. Both controls are Gap. |
| V6.2.4, V6.2.12 | Product routes enforce the shared password length bounds; `apps/backend/config/account_kit.ts` enables password flows without common-password or breach screening. `DECISIONS.md` records the absence of breached-password screening. |
| V6.3.7 | Account Kit credential-change notifications are configured in `apps/backend/config/account_kit.ts`; the product exposes password change/reset but no email-change route in `apps/backend/start/auth_routes.ts`. |
| V6.4.6 | Account Kit operator commands are registered in `apps/backend/adonisrc.ts`; `apps/backend/app/services/operations/owner_recovery.ts` adds the stopped-server sole-Owner recovery path and audit. The product has no Admin-triggered reset route. |
| V6.8, V7.6.1, V9, V10 | `apps/backend/app/controllers/auth_controller.ts` reports `password-only`; `apps/backend/start/auth_routes.ts` registers no federation or OAuth callback routes. |
| V7.3.2, V7.4.5, V7.5.2 | `apps/backend/app/services/auth/session_expiry.ts` sets a 14-day idle expiry; `apps/backend/config/account_kit.ts` enables session management; `apps/backend/start/auth_routes.ts` has no session inventory or administrator revocation route. |
| V7.1.1–V7.1.3 | `apps/backend/config/account_kit.ts` sets a 14-day idle expiry; it does not configure an absolute lifetime or concurrent-session cap. Current docs record the absence of an absolute lifetime but not its risk rationale; unlimited concurrent sessions are allowed with no count-based eviction. No federation exists. |
| V7.5.3 | `apps/backend/app/services/auth/action_proof.ts` binds single-use, five-minute password proofs to user, Kit session, company, action and intent. |
| V11.3 | `apps/backend/config/encryption.ts` declares AES-256-GCM using `APP_KEY`; no application call site proving which stored data uses it was identified, so the classifications remain Partial. |
| V11.4.1–V11.4.4 | SHA-256 is used for token and intent digests (approved hash and adequate digest length); password scrypt meets the selected OWASP minimum profile (Met); the application does not derive encryption keys from passwords (N/A). |
| V16.3.1, V16.3.3 | `apps/backend/app/middleware/request_logging_middleware.ts` is opt-in and records event, method, route, status, outcome and correlation ID, but no latency; authority/proof/validation/Kit failures are not individually logged, so V16.3.3 is Partial. |

## Input-boundary evidence update (2026-10-10)

Historical input-boundary evidence from 2026-10-10. This evidence predates the Account Kit cutover; current classifications and the 2026-10-26 amendment above supersede authentication-specific claims. The source checks
were made against the applicable [ASVS 5.0.0 release](https://github.com/OWASP/ASVS/tree/v5.0.0_release) and
[Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

| Controls | Evidence and limit | Assessment boundary |
| --- | --- | --- |
| V1.1, V1.2, V1.3, V2.1–V2.2 | Shared NFC/whitespace normalization runs before 100-code-point name and 1,000-code-point note limits; strict ordinary-write validation rejects malformed supplied fields while import repair remains separate. React renders text as text and SQLite binds values. | No rich-HTML or dynamic SQL sink was found in the reviewed paths. Valid punctuation remains allowed. |
| V1.4–V1.5, V4.1–V4.2 | Adonis BodyParser owns JSON syntax and uses its supported defaults; compiled Vine validators reject invalid supplied values and strip unknown object fields. | Authentication requests use the same framework parser. Duplicate-key, depth, and numeric-range guarantees are not added by the application boundary. |
| V2.3–V2.4, V5.1–V5.2 | Import and batch bodies use the framework parser defaults; server import replacement remains atomic. Approved-domain input is capped at 50 raw entries and 16 KiB UTF-8 before IDNA. | Imported legacy row repair or skipping remains deliberate and reported; malformed JSON cannot replace stored data. |
| V8.1–V8.4 | Scope, relationship, lifecycle, repeat-series and confidential-field pins remain enforced by the server independently of form visibility. | Blind writers may echo redacted or blank hidden fields; the stored confidential value is retained. Existing role and tenant tests cover these exceptions. |
| V16.2–V16.5 | Parser failures return an allowlisted 400 error; rejected values, passwords and setup secrets are not included in the response. Structured audit/security logging retains its existing redaction and failure policy. | Deployment log retention and external collector controls remain Partial where shown above. |

### Remaining input-related assurance boundaries

The control IDs and classifications in the main tables remain authoritative. The following
Partial/Gap outcomes identify what evidence or separate capability would be needed; these are
not claims that input validation alone completes another control.

| Control IDs and current status | Remaining outcome and evidence owner |
| --- | --- |
| V1.1.1, V1.5.3 — Partial | Maintainers must audit every parser and downstream encoding context, including Account Kit password and recovery request bodies, against the maintained parser contracts; the application scan does not cover `/api/auth/`. |
| V1.3.11 — Partial | Account addresses are validated and handed to structured `nodemailer` fields. The review has not proved every user-controlled SMTP field and transport library behavior against header injection. |
| V4.1.2 — Partial | Historical 2026-10-10 proxy evidence; current product routes call Account Kit directly and have no authentication proxy. Reassess deployed HTTP redirect behavior separately. |
| V4.1.3, V4.2.1–V4.2.4 — Partial | Historical 2026-10-10 proxy evidence. Current product routes call Account Kit directly and have no authentication proxy; deployed proxy/Node framing and trusted-forwarding still require deployment evidence. |
| V4.2.5 — Partial | Maintainers must bound constructed outbound URI and header fields against each receiving service's accepted size; transport response limits do not establish that request-side property. |
| V5.2.2 — Partial | Import parses and validates JSON content, while the file chooser's `.json` hint does not enforce extension/content agreement. Maintainers would need an explicit filename and content check for this control. |
| V5.4.1 — N/A | Export uses a fixed browser Blob filename through `anchor.download`; it has no HTTP attachment response or user-submitted download filename. No `Content-Disposition` header is emitted or claimed. |
| V6.2.4, V6.2.12 — Gap | There is no common-password list or breached-password screening at product password routes. |
| V6.4.6 — Partial | A host operator can issue a Kit reset link, but an application Admin cannot initiate this flow in the product. |
| V6.3.8 — Partial | Generic messages alone do not prove indistinguishable response codes and timing across login, registration and recovery. Maintainers need differential boundary tests and timing assessment. |
| V6.3.3, V6.3.5 — Gap | Password-only access does not meet the multi-factor requirement; suspicious-attempt notices are absent. |
| V6.3.7 — Partial | Account Kit sends notices after password change and reset completion when mail is configured. No email-change route is exposed by the product. |
| V8.2.4 — Gap; V8.4.2 — Partial | Adaptive device/risk authorization is absent, and action-bound password proofs cover only the specified sensitive actions. Maintainers would need a separate product decision and enforcement tests to change this scope. |
| V16.2.2, V16.3.2, V16.4.2–V16.4.3 — Partial | Operators must provide clock and external collector/ACL/retention evidence; maintainers would need additional event coverage for successful high-assurance decisions. Local safe-error tests do not prove those deployment controls. |
| V16.5.4 — Gap | The 2026-10-26 source review found no process-wide last-resort handler; `apps/backend/bin/server.ts` catches startup failure only. |
| V16.1.1, V16.2.4 — Partial | The checked-in logging inventory does not establish deployed retention/access or show that the selected log processor can read and correlate each stream. Operators must supply processor and access evidence. |

## Interpretation

CapacityLens supports password sign-in only and has no local multi-factor authentication or breached-password screening. It therefore does not meet V6.3.3 L2. A Gap in a Level 3-only requirement documents a higher-assurance boundary rather than an L2 failure. Partial/Gap controls remain real limitations, including authentication event logging, URL bearer links and deployment public-TLS/secret/log/storage evidence.
