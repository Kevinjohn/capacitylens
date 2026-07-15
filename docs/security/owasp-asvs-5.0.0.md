# OWASP ASVS 5.0.0 complete control ledger

Assessment date: 2026-07-14; posture updated 2026-07-15. Target: ASVS Level 2 when optional hardening
is enabled, with every Level 1–3 requirement assessed.
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

Point-in-time totals: **199 Pass, 48 Partial, 7 Gap and 91 N/A = 345**. These counts include all
levels; they are not a score or certification percentage.

## V1 Encoding and sanitization

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V1.1 Architecture | Fastify parses once; shared sanitisation precedes domain use; React/JSON perform contextual output encoding | V1.1.2 | V1.1.1 | — | — |
| V1.2 Injection prevention | React text nodes, encoded URL components, structured JSON, parameterized SQLite, fixed/bounded regex | V1.2.1, V1.2.2, V1.2.3, V1.2.4, V1.2.9 | — | — | V1.2.5, V1.2.6, V1.2.7, V1.2.8, V1.2.10 |
| V1.3 Sanitization | No eval; context-specific codecs/lengths; operator-only HTTPS URL allow-list; bounded fixed regex | V1.3.2, V1.3.3, V1.3.6, V1.3.12 | — | — | V1.3.1, V1.3.4, V1.3.5, V1.3.7, V1.3.8, V1.3.9, V1.3.10, V1.3.11 |
| V1.4 Memory/numeric safety | Memory-safe JS/TS runtime, bounded integer parsers and explicit shutdown/resource release | V1.4.1, V1.4.2, V1.4.3 | — | — | — |
| V1.5 Safe parsing | Typed JSON/object allow-listing; Node URL parser; no XML | V1.5.2 | V1.5.3 | — | V1.5.1 |

## V2 Validation and business logic

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V2.1 Documentation | `AGENTS.md`, `DEFENSIVE-CODING.md`, domain invariants and control inventory define shape/context/limits | V2.1.1, V2.1.2, V2.1.3 | — | — | — |
| V2.2 Enforcement | Server/domain validation is authoritative; related entity/account/date/activity rules checked | V2.2.1, V2.2.2, V2.2.3 | — | — | — |
| V2.3 Flows/transactions | Setup/invite/MFA order, SQLite transactions, optimistic concurrency and atomic import | V2.3.1, V2.3.2, V2.3.3 | — | — | V2.3.4, V2.3.5 |
| V2.4 Anti-automation | API/health throttling and request/import/batch bounds | V2.4.1 | — | — | V2.4.2 |

## V3 Web frontend security

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V3.1 Browser feature model | Evergreen-browser cross-browser suite and security headers; no full incompatible-browser block | — | V3.1.1 | — | — |
| V3.2 Rendering context | JSON MIME/nosniff/CORP plus React text rendering and TypeScript module scope | V3.2.1, V3.2.2, V3.2.3 | — | — | — |
| V3.3 Cookies | HTTPS emits Secure, Path=/, domain-free `__Host-` cookies; HTTP loopback uses development names; SameSite=Lax, HttpOnly and bounded cookies | V3.3.1, V3.3.2, V3.3.3, V3.3.4, V3.3.5 | — | — | — |
| V3.4 Browser headers | Two-year subdomain HSTS, exact CORS, CSP with inline style elements forbidden, nosniff, no-referrer, frame denial and COEP/COOP/CORP; bounded CSP reports project into the security stream | V3.4.1, V3.4.2, V3.4.4, V3.4.5, V3.4.6, V3.4.7, V3.4.8 | V3.4.3 | — | — |
| V3.5 Cross-origin controls | Unsafe Origin/Fetch-Metadata rejection, correct methods, no JSONP/script data, same-origin CORP | V3.5.1, V3.5.2, V3.5.3, V3.5.6, V3.5.7, V3.5.8 | — | — | V3.5.4, V3.5.5 |
| V3.6 External assets | Runtime JS/CSS/fonts are self-hosted; no CDN runtime dependency | V3.6.1 | — | — | — |
| V3.7 Client behavior | Supported web platform only; external provider navigation is explicit/user-selected; preload/incompatible-browser behavior is deployment-dependent | V3.7.1, V3.7.2, V3.7.3 | V3.7.4, V3.7.5 | — | — |

## V4 API and web service

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V4.1 HTTP use | Correct content types, TLS at public proxy, explicit methods; trusted forwarding depends on packaged/operator proxy | V4.1.1, V4.1.2, V4.1.4 | V4.1.3 | — | V4.1.5 |
| V4.2 Message framing | Current nginx/Fastify/Node framing; auth proxy strips length/transfer headers; provider output bounded | V4.2.5 | V4.2.1, V4.2.2, V4.2.3, V4.2.4 | — | — |
| V4.3 GraphQL | No GraphQL endpoint | — | — | — | V4.3.1, V4.3.2 |
| V4.4 WebSocket | No WebSocket endpoint | — | — | — | V4.4.1, V4.4.2, V4.4.3, V4.4.4 |

## V5 File handling

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V5.1 Documentation | JSON import is the sole file-like input; type, 5 MiB and record limits documented/tested | V5.1.1 | — | — | — |
| V5.2 Uploaded content | JSON content parsed/validated with body/record caps; no archives or images are accepted/stored | V5.2.1, V5.2.2 | — | — | V5.2.3, V5.2.4, V5.2.5, V5.2.6 |
| V5.3 Storage/path | Server data/audit/backup paths are operator configuration, not user filenames; no public uploaded code/archive | V5.3.2 | — | — | V5.3.1, V5.3.3 |
| V5.4 Downloads | Export filename is internally generated and safe; no untrusted served files | V5.4.1, V5.4.2 | — | — | V5.4.3 |

## V6 Authentication

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V6.1 Documentation | Auth pathways, throttling/lockout, context words, password/MFA/SSO strength documented | V6.1.1, V6.1.2, V6.1.3 | — | — | — |
| V6.2 Passwords | 15–128, change/current-password flow, HIBP by default, no composition rule, paste/managers, exact bytes, no periodic expiry; breach checking can be disabled with a warning | V6.2.1, V6.2.2, V6.2.3, V6.2.4, V6.2.5, V6.2.6, V6.2.7, V6.2.8, V6.2.9, V6.2.10, V6.2.11 | V6.2.12 | — | — |
| V6.3 Authentication controls | API throttling/MFA lockout, no default account, opt-in required TOTP, consistent documented paths and generic failures; default password mode is single-factor and no phishing-resistant factor/user notifications exist | V6.3.1, V6.3.2, V6.3.4, V6.3.6, V6.3.8 | V6.3.3 | V6.3.5, V6.3.7 | — |
| V6.4 Recovery | Production setup avoids initial passwords; no hints; reset preserves MFA and revokes sessions; lost TOTP requires password plus an enrollment-issued one-time recovery code, with no weaker admin/email bypass | V6.4.1, V6.4.2, V6.4.3, V6.4.4, V6.4.6 | — | — | V6.4.5 |
| V6.5 Factor properties | CSPRNG seeds/codes, protected recovery material, 30-second TOTP/server time, lockout and revocation; library does not evidence same-window TOTP replay storage | V6.5.2, V6.5.3, V6.5.4, V6.5.5, V6.5.6, V6.5.8 | V6.5.1 | — | V6.5.7 |
| V6.6 Out-of-band/PSTN | No SMS, phone, email-code or push factor | — | — | — | V6.6.1, V6.6.2, V6.6.3, V6.6.4 |
| V6.7 Cryptographic authenticator | No hardware cryptographic authenticator | — | — | — | V6.7.1, V6.7.2 |
| V6.8 Federated identity | Provider+subject identity, maintained signature validation, no SAML; SSO MFA is an operator assurance rather than claim-level enforcement | V6.8.1, V6.8.2 | V6.8.4 | — | V6.8.3 |

## V7 Session management

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V7.1 Documentation | Absolute/freshness/concurrency policy documented; provider session coordination remains experimental | V7.1.1, V7.1.2 | V7.1.3 | — | — |
| V7.2 Token creation/verification | Backend stateful CSPRNG reference sessions; new token on authentication | V7.2.1, V7.2.2, V7.2.3, V7.2.4 | — | — | — |
| V7.3 Timeouts | Fixed 12-hour absolute limit, 30-minute server-enforced inactivity expiry and no sliding absolute refresh | V7.3.1, V7.3.2 | — | — | — |
| V7.4 Termination | Logout/expiry/deletion/reset/revocation are immediate; self/admin controls and visible logout | V7.4.1, V7.4.2, V7.4.3, V7.4.4, V7.4.5 | — | — | — |
| V7.5 Reauthentication | Current password/MFA verification and fresh privileged actions; session termination uses freshness rather than an always-new prompt | V7.5.1, V7.5.3 | V7.5.2 | — | — |
| V7.6 Federation | Session creation is user-initiated; provider logout/lifetime coordination needs provider testing | V7.6.2 | V7.6.1 | — | — |

## V8 Authorization

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V8.1 Documentation | Function/data/field/action rules and only contextual control (session freshness) are documented | V8.1.1, V8.1.2, V8.1.3, V8.1.4 | — | — | — |
| V8.2 Enforcement | Central role/action, account/object/parent-reference and field rules; project-bound writes fail closed when the parent cannot be resolved in-tenant; no adaptive environment/device engine | V8.2.1, V8.2.2, V8.2.3 | — | V8.2.4 | — |
| V8.3 Trusted layer/immediacy | Server-side DB membership on every operation; changes/revocations immediate; no privilege-bearing intermediary | V8.3.1, V8.3.2, V8.3.3 | — | — | — |
| V8.4 Multi-tenancy/admin | Independent cross-tenant enforcement; admin always has freshness and may have required MFA, but no continuous device/risk assessment | V8.4.1 | V8.4.2 | — | — |

## V9 Self-contained tokens

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V9.1 Integrity | Application sessions are stateful; configured OIDC assertions use maintained issuer/signature/algorithm/key validation | V9.1.1, V9.1.2, V9.1.3 | — | — | — |
| V9.2 Claims | Provider tokens are checked for validity, type and audience by the protocol library; CapacityLens is not a token issuer | V9.2.1, V9.2.2, V9.2.3 | — | — | V9.2.4 |

## V10 OAuth and OIDC

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V10.1 Token/client binding | Provider tokens stay server-side; state/nonce/transaction binding delegated to configured maintained clients | V10.1.1, V10.1.2 | — | — | — |
| V10.2 Client flows | Library state/PKCE/mix-up defenses; least default scopes | V10.2.1, V10.2.2, V10.2.3 | — | — | — |
| V10.3 Resource server | CapacityLens does not accept OAuth access tokens as an API resource server | — | — | — | V10.3.1, V10.3.2, V10.3.3, V10.3.4, V10.3.5 |
| V10.4 Authorization server | CapacityLens is not an OAuth authorization server | — | — | — | V10.4.1, V10.4.2, V10.4.3, V10.4.4, V10.4.5, V10.4.6, V10.4.7, V10.4.8, V10.4.9, V10.4.10, V10.4.11, V10.4.12, V10.4.13, V10.4.14, V10.4.15, V10.4.16 |
| V10.5 OIDC relying party | Maintained nonce/subject/issuer/audience validation; no back-channel logout | V10.5.1, V10.5.2, V10.5.3, V10.5.4 | — | — | V10.5.5 |
| V10.6 OpenID Provider | CapacityLens is not an OpenID Provider | — | — | — | V10.6.1, V10.6.2 |
| V10.7 Consent | CapacityLens is not an authorization server managing third-party grants | — | — | — | V10.7.1, V10.7.2, V10.7.3 |

## V11 Cryptography

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V11.1 Inventory/lifecycle | Repository crypto inventory plus a gate-enforced automated implementation-path discovery check; deployment key rotation/PQC migration remain operator/planning work | V11.1.2, V11.1.3 | V11.1.1, V11.1.4 | — | — |
| V11.2 Design/implementation | Node/Web Crypto/Better Auth, ≥128-bit primitives and fail-closed errors; versioned formats but legacy hashes and library timing remain | V11.2.1, V11.2.3, V11.2.5 | V11.2.2, V11.2.4 | — | — |
| V11.3 Symmetric encryption | AES-256-GCM authenticated encryption with random per-record IV and AAD; no separate cipher+MAC construction | V11.3.1, V11.3.2, V11.3.3, V11.3.4 | — | — | V11.3.5 |
| V11.4 Hash/KDF | SHA-256 token digests, versioned OWASP scrypt and appropriate derived lengths; SHA-1 only for non-verifier HIBP protocol | V11.4.1, V11.4.2, V11.4.3, V11.4.4 | — | — | — |
| V11.5 Randomness | Platform CSPRNG with ≥128-bit security for tokens/keys and OS heavy-demand behavior | V11.5.1, V11.5.2 | — | — | — |
| V11.6 Key generation/exchange | Platform-approved generation and TLS exchange primitives | V11.6.1, V11.6.2 | — | — | — |
| V11.7 In-use data | Data minimisation/short-lived values exist; no full-memory encryption and necessary plaintext exists while processing | — | V11.7.2 | V11.7.1 | — |

## V12 Secure communication

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V12.1 TLS configuration | Public TLS/version/ciphers are proxy/operator evidence; no mTLS client; OCSP/ECH not supplied by app | — | V12.1.1, V12.1.2 | V12.1.4, V12.1.5 | V12.1.3 |
| V12.2 Public services | Documentation mandates public TLS/trusted certificates, but source review cannot verify a deployed endpoint | — | V12.2.1, V12.2.2 | — | — |
| V12.3 Other connections | Outbound HTTPS validates certificates; packaged nginx verifies a per-install CA/service identity over TLS 1.2/1.3, while same-host bare-metal HTTP is permitted; public monitoring/operator protocols are external | V12.3.2 | V12.3.1, V12.3.3 | — | V12.3.4, V12.3.5 |

## V13 Configuration

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V13.1 Communication/resources | Communication inventory defines socket/service/work maxima, queue/timeout/refusal behavior and recovery; deployment certificate/credential rotation remains operator-specific | V13.1.1, V13.1.2 | V13.1.3, V13.1.4 | — | — |
| V13.2 Backend communication | Unprivileged components, no defaults, fixed/configured outbound endpoints; network egress and connection policy require deployment controls | V13.2.2, V13.2.3 | V13.2.4, V13.2.5, V13.2.6 | — | V13.2.1 |
| V13.3 Secret management | Docs require secret manager/least privilege/rotation; env delivery is supported, not a vault/HSM or enforced expiry | — | V13.3.1, V13.3.2, V13.3.4 | V13.3.3 | — |
| V13.4 Production exposure | `.dockerignore`, production-only dependencies, no debug/reset, no listing/TRACE, intentional health, no detailed backend versions, exact static-file handling | V13.4.1, V13.4.2, V13.4.3, V13.4.4, V13.4.5, V13.4.6, V13.4.7 | — | — | — |

## V14 Data protection

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V14.1 Classification | Privacy/control inventories identify data classes and application/operator protections | V14.1.1, V14.1.2 | — | — | — |
| V14.2 Server-side protection | API no-store, no trackers, projection/minimisation and 404 file behavior; link tokens, deployment storage and retention remain partial | V14.2.2, V14.2.3, V14.2.5, V14.2.6 | V14.2.1, V14.2.4, V14.2.7 | — | V14.2.8 |
| V14.3 Browser data | API no-store; logout clears offline data, but no universal Clear-Site-Data; encrypted opt-in tenant snapshots still reside in IndexedDB | V14.3.2 | V14.3.1, V14.3.3 | — | — |

## V15 Secure coding and architecture

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V15.1 Documentation/inventory | Remediation policy, SBOM/third parties, expensive/risky/dangerous function inventory | V15.1.1, V15.1.2, V15.1.3, V15.1.4, V15.1.5 | — | — | — |
| V15.2 Components/resources | Audits/scans, bounded heavy paths, minimal production graph with leak assertion, lockfile-recorded patch, non-root read-only containers | V15.2.1, V15.2.2, V15.2.3, V15.2.4, V15.2.5 | — | — | — |
| V15.3 Defensive implementation | Output projection, no-redirect outbound call, allowlisted fields, trusted proxy, strict TS/types/prototype/parameter handling | V15.3.1, V15.3.2, V15.3.3, V15.3.4, V15.3.5, V15.3.6, V15.3.7 | — | — | — |
| V15.4 Concurrency | SQLite transactions/atomic state checks; no application multithreading/shared worker pool | V15.4.2 | — | — | V15.4.1, V15.4.3, V15.4.4 |

## V16 Security logging and error handling

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V16.1 Inventory | Layer/event/format/destination/sensitivity inventory; operator supplies exact retention/access | V16.1.1 | — | — | — |
| V16.2 Log content | UTC ISO metadata, documented JSON streams, correlation-ready data and credential/body redaction; clock synchronization is external | V16.2.1, V16.2.3, V16.2.4, V16.2.5 | V16.2.2 | — | — |
| V16.3 Security events | Auth, bypass/control failures and unexpected errors logged; failed authz covered but not every successful L3 decision | V16.3.1, V16.3.3, V16.3.4 | V16.3.2 | — | — |
| V16.4 Log protection | JSON serialization prevents injection and local files have restrictive modes; external forwarding is optional and its ACL/immutability need operator evidence | V16.4.1 | V16.4.2, V16.4.3 | — | — |
| V16.5 Failure handling | Generic responses, fail-closed external/control failures and transaction rollback; a process-wide last-resort handler records the local error plus a sanitized security event, drains, exits non-zero and relies on supervisor restart rather than continuing potentially corrupt state | V16.5.1, V16.5.2, V16.5.3 | V16.5.4 | — | — |

## V17 WebRTC

| Section | Evidence summary | Pass | Partial | Gap | N/A |
|---|---|---|---|---|---|
| V17.1 TURN | No WebRTC/TURN | — | — | — | V17.1.1, V17.1.2 |
| V17.2 Media | No DTLS/SRTP/media server or recording | — | — | — | V17.2.1, V17.2.2, V17.2.3, V17.2.4, V17.2.5, V17.2.6, V17.2.7, V17.2.8 |
| V17.3 Signaling | No WebRTC signaling server | — | — | — | V17.3.1, V17.3.2 |

## Interpretation

The application can be configured for the ASVS Level 2 risk band but the community defaults no
longer force that posture: password MFA is optional and breach screening can be disabled. A
password-only deployment therefore does not meet V6.3.3 L2. A Gap in a Level 3-only requirement
still documents a conscious higher-assurance boundary rather than an L2 failure. Partial/Gap L1/L2
controls remain real limitations, particularly optional authentication hardening, federated-provider
proof, URL bearer links and deployment public-TLS/secret/log/storage evidence.
