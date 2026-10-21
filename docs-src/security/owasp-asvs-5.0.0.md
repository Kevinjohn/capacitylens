---
title: OWASP ASVS 5.0.0 complete control ledger
description: ASVS 5.0.0 control ledger assessed in 2026 with a 2026-10-09 local MFA update.
---

# OWASP ASVS 5.0.0 complete control ledger

Assessment date: 2026-08-18; local MFA posture updated 2026-10-09. Every Level 1–3 requirement is assessed. Password-only deployments do not meet the Level 2 multi-factor requirement.
Baseline: OWASP Application Security Verification Standard 5.0.0 (May 2025), 345 requirements.

This ledger is an evidence-based source/configuration review, not an OWASP certification. It uses:

- **Pass** — implemented or deliberately avoided, with repository evidence and tests where practical;
- **Partial** — meaningful controls exist, but a clause, deployment proof or higher-assurance aspect is incomplete;
- **Gap** — applicable requirement is not implemented;
- **N/A** — the governed technology/function does not exist in CapacityLens.

An inherited library/framework control is only marked Pass where the application constrains its use
and the behavior is covered by configuration/tests or the maintained library contract. External
TLS, disks, collectors, secret stores and identity-provider policy cannot become Pass merely because
an environment acknowledgement is set; those stay Partial where deployment evidence is required.
Requirement descriptions are not reproduced here; use the official ASVS release alongside these IDs.

Original 2026-08-18 totals: **200 Pass, 48 Partial, 7 Gap and 90 N/A = 345**. Following the 2026-10-09 local MFA removal and this control review, the amended rows total **185 Pass, 54 Partial, 8 Gap and 98 N/A = 345**. These are not a score or certification percentage.

## V1 Encoding and sanitization

| Section                    | Evidence summary                                                                                            | Pass                                   | Partial | Gap | N/A                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | --- | ---------------------------------------------------------------- |
| V1.1 Architecture          | Fastify parses once; shared sanitisation precedes domain use; React/JSON perform contextual output encoding | V1.1.2                                 | V1.1.1  | —   | —                                                                |
| V1.2 Injection prevention  | React text nodes, encoded URL components, structured JSON, parameterized SQLite, fixed/bounded regex        | V1.2.1, V1.2.2, V1.2.3, V1.2.4, V1.2.9 | —       | —   | V1.2.5, V1.2.6, V1.2.7, V1.2.8, V1.2.10                          |
| V1.3 Sanitization          | No eval; context-specific codecs/lengths; operator-only HTTPS URL allow-list; bounded fixed regex; account email uses structured SMTP transport fields | V1.3.2, V1.3.3, V1.3.6, V1.3.12 | V1.3.11 | — | V1.3.1, V1.3.4, V1.3.5, V1.3.7, V1.3.8, V1.3.9, V1.3.10 |
| V1.4 Memory/numeric safety | Memory-safe JS/TS runtime, bounded integer parsers and explicit shutdown/resource release                   | V1.4.1, V1.4.2, V1.4.3                 | —       | —   | —                                                                |
| V1.5 Safe parsing          | Typed JSON/object allow-listing; Node URL parser; no XML                                                    | V1.5.2                                 | V1.5.3  | —   | V1.5.1                                                           |

## V2 Validation and business logic

| Section                 | Evidence summary                                                                                        | Pass                   | Partial | Gap | N/A            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- | ------- | --- | -------------- |
| V2.1 Documentation      | `AGENTS.md`, `DEFENSIVE-CODING.md`, domain invariants and control inventory define shape/context/limits | V2.1.1, V2.1.2, V2.1.3 | —       | —   | —              |
| V2.2 Enforcement        | Server/domain validation is authoritative; related entity/account/date/activity rules checked           | V2.2.1, V2.2.2, V2.2.3 | —       | —   | —              |
| V2.3 Flows/transactions | Setup/invite/link/cutover order, SQLite transactions, sync provenance, stale-import checks and atomic replacement | V2.3.1, V2.3.2, V2.3.3 | —       | —   | V2.3.4, V2.3.5 |
| V2.4 Anti-automation    | API/health throttling and request/import/batch bounds                                                   | V2.4.1                 | —       | —   | V2.4.2         |

## V3 Web frontend security

| Section                    | Evidence summary                                                                                                                                                                           | Pass                                                   | Partial        | Gap | N/A            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------- | --- | -------------- |
| V3.1 Browser feature model | Evergreen-browser cross-browser suite and security headers; no full incompatible-browser block                                                                                             | —                                                      | V3.1.1         | —   | —              |
| V3.2 Rendering context     | JSON MIME/nosniff/CORP plus React text rendering and TypeScript module scope                                                                                                               | V3.2.1, V3.2.2, V3.2.3                                 | —              | —   | —              |
| V3.3 Cookies               | HTTPS emits Secure, Path=/, domain-free `__Host-` cookies; HTTP loopback uses development names; SameSite=Lax, HttpOnly and bounded cookies                                                | V3.3.1, V3.3.2, V3.3.3, V3.3.4, V3.3.5                 | —              | —   | —              |
| V3.4 Browser headers       | Two-year host-only HSTS, exact CORS, CSP with inline style elements forbidden, nosniff, no-referrer, frame denial and COEP/COOP/CORP; bounded CSP reports project into the security stream | V3.4.1, V3.4.2, V3.4.4, V3.4.5, V3.4.6, V3.4.7, V3.4.8 | V3.4.3         | —   | —              |
| V3.5 Cross-origin controls | Unsafe Origin/Fetch-Metadata rejection, correct methods, no JSONP/script data, same-origin CORP                                                                                            | V3.5.1, V3.5.2, V3.5.3, V3.5.6, V3.5.7, V3.5.8         | —              | —   | V3.5.4, V3.5.5 |
| V3.6 External assets       | Runtime JS/CSS/fonts are self-hosted; no CDN runtime dependency                                                                                                                            | V3.6.1                                                 | —              | —   | —              |
| V3.7 Client behavior       | Supported web platform only; external provider navigation is explicit/user-selected; preload/incompatible-browser behavior is deployment-dependent                                         | V3.7.1, V3.7.2, V3.7.3                                 | V3.7.4, V3.7.5 | —   | —              |

## V4 API and web service

| Section              | Evidence summary                                                                                                    | Pass                   | Partial                        | Gap | N/A                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ | --- | ------------------------------ |
| V4.1 HTTP use        | Correct content types and explicit methods; packaged TLS proxy behavior needs deployment proof | V4.1.1, V4.1.4 | V4.1.2, V4.1.3 | — | V4.1.5 |
| V4.2 Message framing | Current nginx/Fastify/Node framing; auth proxy strips length/transfer headers; outbound URI/header compatibility needs evidence | — | V4.2.1, V4.2.2, V4.2.3, V4.2.4, V4.2.5 | — | — |
| V4.3 GraphQL         | No GraphQL endpoint                                                                                                 | —                      | —                              | —   | V4.3.1, V4.3.2                 |
| V4.4 WebSocket       | No WebSocket endpoint                                                                                               | —                      | —                              | —   | V4.4.1, V4.4.2, V4.4.3, V4.4.4 |

## V5 File handling

| Section               | Evidence summary                                                                                               | Pass           | Partial | Gap | N/A                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- | ------- | --- | ------------------------------ |
| V5.1 Documentation    | JSON import is the sole file-like input; type, 5 MiB and record limits documented/tested                       | V5.1.1         | —       | —   | —                              |
| V5.2 Uploaded content | JSON content parsed/validated with body/record caps; extension/content agreement is not enforced | V5.2.1 | V5.2.2 | — | V5.2.3, V5.2.4, V5.2.5, V5.2.6 |
| V5.3 Storage/path     | Server data/audit/backup paths are operator configuration, not user filenames; no public uploaded code/archive | V5.3.2         | —       | —   | V5.3.1, V5.3.3                 |
| V5.4 Downloads        | Export is a browser Blob with a fixed anchor download name, not an HTTP attachment response | V5.4.2 | — | — | V5.4.1, V5.4.3 |

## V6 Authentication

| Section                          | Evidence summary                                                                                                                                                                                                         | Pass                                                                                     | Partial | Gap            | N/A                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------- | -------------- | ------------------------------ |
| V6.1 Documentation               | Auth pathways, throttling/lockout, context words, password and company-provider strength documented                                                                                                                                   | V6.1.1, V6.1.2, V6.1.3                                                                   | —       | —              | —                              |
| V6.2 Passwords                   | 15–128, change/current-password flow, HIBP by default, no composition rule, paste/managers, exact bytes, no periodic expiry; a guaranteed top-3000 policy-matching list is not proved | V6.2.1, V6.2.2, V6.2.3, V6.2.5, V6.2.6, V6.2.7, V6.2.8, V6.2.9, V6.2.10, V6.2.11 | V6.2.4, V6.2.12 | — | — |
| V6.3 Authentication controls     | API throttling, no default account, documented paths; failed-challenge indistinguishability across responses and timing remains unproved | V6.3.1, V6.3.2, V6.3.4, V6.3.6 | V6.3.8 | V6.3.3, V6.3.5, V6.3.7 | — |
| V6.4 Recovery                    | Production setup avoids initial passwords; password reset revokes sessions; stopped-server sole-Owner recovery uses the same single-use flow and exact eligibility; local MFA recovery does not apply | V6.4.1, V6.4.2, V6.4.3, V6.4.6 | — | — | V6.4.4, V6.4.5 |
| V6.5 Factor properties | No local authenticator, TOTP enrolment or recovery-code flow; Google and Microsoft own any factor policy | — | — | — | V6.5.1, V6.5.2, V6.5.3, V6.5.4, V6.5.5, V6.5.6, V6.5.7, V6.5.8 |
| V6.6 Out-of-band/PSTN            | No SMS, phone, email-code or push factor                                                                                                                                                                                 | —                                                                                        | —       | —              | V6.6.1, V6.6.2, V6.6.3, V6.6.4 |
| V6.7 Cryptographic authenticator | No hardware cryptographic authenticator                                                                                                                                                                                  | —                                                                                        | —       | —              | V6.7.1, V6.7.2                 |
| V6.8 Federated identity          | Provider+subject identity, asymmetric signature validation, verified-email admission and explicit linking; SSO MFA remains an operator assurance rather than claim-level enforcement                                    | V6.8.1, V6.8.2                                                                           | V6.8.4  | —              | V6.8.3                         |

## V7 Session management

| Section                          | Evidence summary                                                                                                                    | Pass                                   | Partial | Gap | N/A |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | --- | --- |
| V7.1 Documentation               | Absolute/freshness/concurrency policy documented; provider session coordination remains experimental                                | V7.1.1, V7.1.2                         | V7.1.3  | —   | —   |
| V7.2 Token creation/verification | Backend stateful CSPRNG reference sessions; new token on authentication                                                             | V7.2.1, V7.2.2, V7.2.3, V7.2.4         | —       | —   | —   |
| V7.3 Timeouts                    | Fixed 12-hour absolute limit, 30-minute server-enforced inactivity expiry and no sliding absolute refresh                           | V7.3.1, V7.3.2                         | —       | —   | —   |
| V7.4 Termination                 | Logout/expiry/deletion/reset/revocation are immediate; self/admin controls and visible logout                                       | V7.4.1, V7.4.2, V7.4.3, V7.4.4, V7.4.5 | —       | —   | —   |
| V7.5 Reauthentication | Current password or provider sign-in and fresh privileged actions; session termination uses freshness rather than an always-new prompt | V7.5.1, V7.5.3 | V7.5.2 | — | — |
| V7.6 Federation                  | Session creation is user-initiated; provider logout/lifetime coordination needs provider testing                                    | V7.6.2                                 | V7.6.1  | —   | —   |

## V8 Authorization

| Section                      | Evidence summary                                                                                                                                                                           | Pass                           | Partial | Gap    | N/A |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------- | ------ | --- |
| V8.1 Documentation           | Function/data/field/action rules and only contextual control (session freshness) are documented                                                                                            | V8.1.1, V8.1.2, V8.1.3, V8.1.4 | —       | —      | —   |
| V8.2 Enforcement             | Central role/action, account/object/parent-reference and field rules; project-bound writes fail closed when the parent cannot be resolved in-tenant; no adaptive environment/device engine | V8.2.1, V8.2.2, V8.2.3         | —       | V8.2.4 | —   |
| V8.3 Trusted layer/immediacy | Server-side DB membership on every operation; changes/revocations immediate; no privilege-bearing intermediary                                                                             | V8.3.1, V8.3.2, V8.3.3         | —       | —      | —   |
| V8.4 Multi-tenancy/admin | Independent cross-tenant enforcement; only specified sensitive actions require freshness; no local MFA gate or continuous device/risk assessment | V8.4.1 | V8.4.2 | — | — |

## V9 Self-contained tokens

| Section        | Evidence summary                                                                                                        | Pass                   | Partial | Gap | N/A    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------- | --- | ------ |
| V9.1 Integrity | Application sessions are stateful; configured OIDC assertions use maintained issuer/signature/algorithm/key validation  | V9.1.1, V9.1.2, V9.1.3 | —       | —   | —      |
| V9.2 Claims    | Provider tokens are checked for validity, type and audience by the protocol library; CapacityLens is not a token issuer | V9.2.1, V9.2.2, V9.2.3 | —       | —   | V9.2.4 |

## V10 OAuth and OIDC

| Section                    | Evidence summary                                                                                             | Pass                               | Partial | Gap | N/A                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| V10.1 Token/client binding | Provider tokens stay server-side and are encrypted at rest; maintained clients provide state/nonce/transaction binding | V10.1.1, V10.1.2                   | —       | —   | —                                                                                                                                                     |
| V10.2 Client flows         | Library state/PKCE/mix-up defenses; least default scopes                                                     | V10.2.1, V10.2.2, V10.2.3          | —       | —   | —                                                                                                                                                     |
| V10.3 Resource server      | CapacityLens does not accept OAuth access tokens as an API resource server                                   | —                                  | —       | —   | V10.3.1, V10.3.2, V10.3.3, V10.3.4, V10.3.5                                                                                                           |
| V10.4 Authorization server | CapacityLens is not an OAuth authorization server                                                            | —                                  | —       | —   | V10.4.1, V10.4.2, V10.4.3, V10.4.4, V10.4.5, V10.4.6, V10.4.7, V10.4.8, V10.4.9, V10.4.10, V10.4.11, V10.4.12, V10.4.13, V10.4.14, V10.4.15, V10.4.16 |
| V10.5 OIDC relying party   | Maintained nonce/subject/issuer/audience validation; no back-channel logout                                  | V10.5.1, V10.5.2, V10.5.3, V10.5.4 | —       | —   | V10.5.5                                                                                                                                               |
| V10.6 OpenID Provider      | CapacityLens is not an OpenID Provider                                                                       | —                                  | —       | —   | V10.6.1, V10.6.2                                                                                                                                      |
| V10.7 Consent              | CapacityLens is not an authorization server managing third-party grants                                      | —                                  | —       | —   | V10.7.1, V10.7.2, V10.7.3                                                                                                                             |

## V11 Cryptography

| Section                       | Evidence summary                                                                                                                                                    | Pass                               | Partial          | Gap     | N/A     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------- | ------- | ------- |
| V11.1 Inventory/lifecycle     | Repository crypto inventory plus a gate-enforced automated implementation-path discovery check; deployment key rotation/PQC migration remain operator/planning work | V11.1.2, V11.1.3                   | V11.1.1, V11.1.4 | —       | —       |
| V11.2 Design/implementation   | Node/Web Crypto/Better Auth, ≥128-bit primitives and fail-closed errors; versioned formats but legacy hashes and library timing remain                              | V11.2.1, V11.2.3, V11.2.5          | V11.2.2, V11.2.4 | —       | —       |
| V11.3 Symmetric encryption    | Authenticated offline AES-256-GCM plus Better Auth provider-token encryption; no separate cipher+MAC construction                                                  | V11.3.1, V11.3.2, V11.3.3, V11.3.4 | —                | —       | V11.3.5 |
| V11.4 Hash/KDF                | SHA-256 token digests, versioned OWASP scrypt and appropriate derived lengths; SHA-1 only for non-verifier HIBP protocol                                            | V11.4.1, V11.4.2, V11.4.3, V11.4.4 | —                | —       | —       |
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
| V14.3 Browser data           | API no-store; logout clears offline data, but no universal Clear-Site-Data; encrypted opt-in tenant snapshots still reside in IndexedDB | V14.3.2                            | V14.3.1, V14.3.3          | —   | —       |

## V15 Secure coding and architecture

| Section                        | Evidence summary                                                                                                                        | Pass                                                          | Partial | Gap | N/A                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- | --- | ------------------------- |
| V15.1 Documentation/inventory  | Remediation policy, SBOM/third parties, expensive/risky/dangerous function inventory                                                    | V15.1.1, V15.1.2, V15.1.3, V15.1.4, V15.1.5                   | —       | —   | —                         |
| V15.2 Components/resources     | Audits/scans, bounded heavy paths, minimal production graph with leak assertion, lockfile-recorded patch, non-root read-only containers | V15.2.1, V15.2.2, V15.2.3, V15.2.4, V15.2.5                   | —       | —   | —                         |
| V15.3 Defensive implementation | Output projection, no-redirect outbound call, allowlisted fields, trusted proxy, strict TS/types/prototype/parameter handling           | V15.3.1, V15.3.2, V15.3.3, V15.3.4, V15.3.5, V15.3.6, V15.3.7 | —       | —   | —                         |
| V15.4 Concurrency              | SQLite atomic checks; import workers receive structured clones, use bounded FIFO slots/deadlines/cancellation, and recheck tenant state before commit | V15.4.2, V15.4.4                                               | —       | —   | V15.4.1, V15.4.3          |

## V16 Security logging and error handling

| Section                | Evidence summary                                                                                                                                                                                                                                                                        | Pass                               | Partial          | Gap | N/A |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------- | --- | --- |
| V16.1 Inventory        | Layer/event/format/destination/sensitivity inventory exists; actual access control and retention need operator evidence | — | V16.1.1 | — | — |
| V16.2 Log content      | UTC ISO metadata, documented JSON streams and credential/body redaction; clock synchronization and deployed processor correlation need evidence | V16.2.1, V16.2.3, V16.2.5 | V16.2.2, V16.2.4 | — | — |
| V16.3 Security events  | Auth, bypass/control failures, queue saturation, SSO cutover/repair, operator recovery and unexpected errors logged; not every successful L3 decision is recorded                                                                                                                       | V16.3.1, V16.3.3, V16.3.4          | V16.3.2          | —   | —   |
| V16.4 Log protection   | JSON serialization prevents injection and local files have restrictive modes; external forwarding is optional and its ACL/immutability need operator evidence                                                                                                                           | V16.4.1                            | V16.4.2, V16.4.3 | —   | —   |
| V16.5 Failure handling | Generic responses, fail-closed external/control failures and transaction rollback; a process-wide last-resort handler records the local error plus a sanitized security event, drains, exits non-zero and relies on supervisor restart rather than continuing potentially corrupt state | V16.5.1, V16.5.2, V16.5.3          | V16.5.4          | —   | —   |

## V17 WebRTC

| Section         | Evidence summary                       | Pass | Partial | Gap | N/A                                                                    |
| --------------- | -------------------------------------- | ---- | ------- | --- | ---------------------------------------------------------------------- |
| V17.1 TURN      | No WebRTC/TURN                         | —    | —       | —   | V17.1.1, V17.1.2                                                       |
| V17.2 Media     | No DTLS/SRTP/media server or recording | —    | —       | —   | V17.2.1, V17.2.2, V17.2.3, V17.2.4, V17.2.5, V17.2.6, V17.2.7, V17.2.8 |
| V17.3 Signaling | No WebRTC signaling server             | —    | —       | —   | V17.3.1, V17.3.2                                                       |

## Input-boundary evidence update (2026-10-10)

The classifications above reflect the SMTP and local MFA applicability corrections as well as new evidence
against the applicable [ASVS 5.0.0 release](https://github.com/OWASP/ASVS/tree/v5.0.0_release) and
[Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

| Controls | Evidence and limit | Assessment boundary |
| --- | --- | --- |
| V1.1, V1.2, V1.3, V2.1–V2.2 | Shared NFC/whitespace normalization runs before 100-code-point name and 1,000-code-point note limits; strict ordinary-write validation rejects malformed supplied fields while import repair remains separate. React renders text as text and SQLite binds values. | No rich-HTML or dynamic SQL sink was found in the reviewed paths. Valid punctuation remains allowed. |
| V1.4–V1.5, V4.1–V4.2 | Fastify's 5 MiB request cap precedes application JSON scanning; the scan rejects duplicate decoded keys, depth over 64, non-finite numbers, unsafe integers and nonzero numeric underflow, then Fastify's hardened parser owns syntax. Browser import rejects malformed UTF-8. | V1.5.3 and V4.2 remain Partial. Provider/authentication protocol requests retain their framework-owned parser and are outside the custom scan; this review did not independently prove every provider payload rule. |
| V2.3–V2.4, V5.1–V5.2 | 200,000 import records and 5,000 batch operations remain capped; strict batch rejection and server import replacement are atomic. Approved-domain input is capped at 50 raw entries and 16 KiB UTF-8 before IDNA. | Imported legacy row repair or skipping remains deliberate and reported; a malformed whole file cannot replace stored data. |
| V8.1–V8.4 | Scope, relationship, lifecycle, repeat-series and confidential-field pins remain enforced by the server independently of form visibility. | Blind writers may echo redacted or blank hidden fields; the stored confidential value is retained. Existing role and tenant tests cover these exceptions. |
| V16.2–V16.5 | Parser failures return an allowlisted 400 error; rejected values, passwords and setup secrets are not included in the response. Structured audit/security logging retains its existing redaction and failure policy. | Deployment log retention and external collector controls remain Partial where shown above. |

### Remaining input-related assurance boundaries

The control IDs and classifications in the main tables remain authoritative. The following
Partial/Gap outcomes identify what evidence or separate capability would be needed; these are
not claims that input validation alone completes another control.

| Control IDs and current status | Remaining outcome and evidence owner |
| --- | --- |
| V1.1.1, V1.5.3 — Partial | Maintainers must audit every parser and downstream encoding context, including provider-owned protocol bodies, against the maintained parser contracts; the application scan does not cover `/api/auth/`. |
| V1.3.11 — Partial | Account addresses are validated and handed to structured `nodemailer` fields. The review has not proved every user-controlled SMTP field and transport library behavior against header injection. |
| V4.1.2 — Partial | The packaged proxy redirects HTTP requests, but the requirement permits automatic redirects only for browser-facing endpoints. Operators and maintainers must show that API requests over HTTP are rejected and cannot hide cleartext client requests. |
| V4.1.3, V4.2.1–V4.2.4 — Partial | Operators must demonstrate the deployed proxy/Node HTTP framing and trusted-forwarding configuration against ambiguous requests; source-level request tests cannot prove a public deployment. |
| V4.2.5 — Partial | Maintainers must bound constructed outbound URI and header fields against each receiving service's accepted size; provider response caps do not establish that request-side property. |
| V5.2.2 — Partial | Import parses and validates JSON content, while the file chooser's `.json` hint does not enforce extension/content agreement. Maintainers would need an explicit filename and content check for this control. |
| V5.4.1 — N/A | Export uses a fixed browser Blob filename through `anchor.download`; it has no HTTP attachment response or user-submitted download filename. No `Content-Disposition` header is emitted or claimed. |
| V6.2.4 — Partial | Context-word checks and optional breached-password screening do not prove that every registration/change rejects the top 3,000 policy-matching passwords. Maintainers need a guaranteed list or equivalent evidence. |
| V6.2.12 — Partial | Operators must prove breached-password screening remains enabled where required; configuration can disable it. |
| V6.8.4 — Partial | Operators must verify the named provider's live factor policy. Maintainers must verify returned authentication-strength and recency claims or apply a conservative fallback; deterministic application tests do not establish that assurance. |
| V6.3.8 — Partial | Generic messages alone do not prove indistinguishable response codes and timing across login, registration and recovery. Maintainers need differential boundary tests and timing assessment. |
| V6.3.3, V6.3.5, V6.3.7 — Gap | Password-only access does not meet the multi-factor requirement, and suspicious-attempt and credential-change notices are absent; input hardening does not implement these capabilities. |
| V8.2.4 — Gap; V8.4.2 — Partial | Adaptive device/risk authorization is absent, and freshness covers only the specified sensitive actions. Maintainers would need a separate product decision and enforcement tests to change this scope. |
| V16.2.2, V16.3.2, V16.4.2–V16.4.3 — Partial | Operators must provide clock and external collector/ACL/retention evidence; maintainers would need additional event coverage for successful high-assurance decisions. Local safe-error tests do not prove those deployment controls. |
| V16.5.4 — Partial | The last-resort handler deliberately drains and terminates on an unhandled failure, then relies on supervisor restart. This fails closed but does not meet the control's literal continue-without-termination limb. |
| V16.1.1, V16.2.4 — Partial | The checked-in logging inventory does not establish deployed retention/access or show that the selected log processor can read and correlate each stream. Operators must supply processor and access evidence. |

## Interpretation

Password-only deployments cannot meet the ASVS Level 2 multi-factor requirement through CapacityLens. Google or Microsoft provider MFA may meet an agency policy when configured and tested there; CapacityLens cannot verify that provider policy. Breach screening can be disabled. A
password-only deployment therefore does not meet V6.3.3 L2. A Gap in a Level 3-only requirement
still documents a conscious higher-assurance boundary rather than an L2 failure. Partial/Gap L1/L2
controls remain real limitations, particularly optional authentication hardening, federated-provider
proof, URL bearer links and deployment public-TLS/secret/log/storage evidence.
