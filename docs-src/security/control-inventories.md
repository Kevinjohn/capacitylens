---
title: Security control inventories
description: Entry points, sensitive-data classes, cryptographic controls, service limits and audit events — reviewed 2026-10-26.
---

# Security control inventories

Version: 2026-10-26. These inventories support ASVS architecture requirements; they are not a
substitute for deployment-specific data classification, key inventory or log-retention policy.

## Entry points and untrusted input

| Input | Format and limit | Trusted enforcement | Security treatment |
| --- | --- | --- | --- |
| Tenant API route, body, query and path | Adonis BodyParser defaults; compiled Vine schemas | Adonis and shared domain | Authenticated operation; server membership/action checks, validated fields and relational checks; unknown Vine object properties are stripped |
| Whole-company import | JSON; framework request-size default | Owner-only API and SQLite | Schema validation, reference checks, import preparation and atomic replacement |
| Password creation, change and reset | 15–128 Unicode code points | Account Kit with application auth routes | Password length validation; no common-password or breached-password screening |
| Sign-in credentials | Email and password in bounded JSON | Account Kit with application auth routes | Generic invalid-credential response and authentication throttling |
| Registration, invitation, address-confirmation and reset links | Bounded JSON/path/header values; invitation 7 days, other emailed links 1 hour | Account Kit plus application routes and admission policy | One-time links are stored as SHA-256 digests; address confirmation and admission are checked before product access |
| Action-proof request | Password plus bounded action/intent payload | Application route and `action_proof.ts` | Owner authority is checked in the current Kit transaction; the five-minute proof binds user, session, company, action and intent and is consumed with the mutation |
| Operator commands | Shell arguments and current SQLite state | Registered Account Kit/operator commands (excluding `account-kit:reset-link`) | Bootstrap issues the first invitation; `owner:reset-password` requires a stopped server and eligible sole Owner and writes an audit row before displaying its link |
| CORS, origin and forwarding headers | HTTP headers | Root middleware and configured proxy trust | Exact origin policy, unsafe cross-site rejection and configured trusted-proxy handling |
| Environment and numeric settings | Process environment | Startup parsers and configuration provider | Bounded integers, explicit boolean grammar and production guards |

There is no runtime XML, LDAP, XPath, GraphQL, WebSocket, WYSIWYG, LaTeX, archive, image,
arbitrary file-upload, CSV/spreadsheet, template, shell-command, JNDI, memcache, WebRTC or media
processing entry point.

## Sensitive data and retention

| Class | Examples | Storage/transport | Retention and disclosure |
| --- | --- | --- | --- |
| Authentication secrets | Password verifier, session id, reset/invitation/action-link tokens | SQLite and session cookie; emailed links through configured SMTP | Session registry expires after 14 days without use; link lifetimes are defined above; raw credentials and bearer values are not written to application logs |
| Identity and admission data | Name, email, memberships, invitation evidence, approval decisions and last sign-in confirmation | SQLite over the configured connection | Retained while needed for account access; identity/account removal follows the account deletion policy |
| Tenant confidential data | Schedule, notes and real private client/project names | SQLite, backups and role-filtered API | Operator controls database, exports, backups and retention |
| Audit metadata | Timestamp, actor, company, action, entity, id and changed field names | Transactional `audit_entries` rows in SQLite | Values and credentials are not included; database and backup retention are operator-controlled |
| Session metadata | User, session registry handle, user-agent label (up to 200 characters), expiry and last-seen time | Kit session registry and application session store in SQLite | 14-day idle expiry; no absolute lifetime or concurrent-session cap; no product session inventory or administrator revocation screen |
| Device preference | Theme, zoom and similar settings | Browser `localStorage` | Device-local and outside company export |

Every `/api/*` response receives `Cache-Control: no-store` and `Pragma: no-cache`. The SPA contains
no advertising, analytics or crash-reporting integration. SMTP is the only default outbound
application service. Its configured connection requires TLS and certificate verification, with
5-second connection and greeting timeouts and a 10-second socket timeout. Authentication mail
contains a one-time bearer link; operators should prevent proxy, SMTP and mailbox logs from
retaining its URL path.

## Cryptographic inventory

| Purpose | Primitive/library | Key/material | Lifecycle and migration |
| --- | --- | --- | --- |
| Password storage | Node scrypt, `N=2^14`, `r=8`, `p=1`; 16-byte salt and 64-byte derived result | Password-derived; random salt | Current profile is below the OWASP Password Storage Cheat Sheet recommendation at the same memory target; see the ASVS ledger; this open code gap is tracked in [issue #1627](https://github.com/Kevinjohn/capacitylens/issues/1627) |
| Password verifier comparison | Adonis scrypt hasher | Stored and derived verifier | Uses framework verification; test coverage is in Account Kit password-flow tests |
| Invitation and reset lookup | Account Kit SHA-256 token digest | Random one-time token shown to the recipient | Expiring, single-use rows are removed or invalidated by the Kit flow |
| Session registry handle | Account Kit random token and SHA-256 digest | Raw token remains in the server session; registry stores the digest | Database-backed session with sliding idle expiry; no maximum simultaneous-session count is configured |
| Action-proof intent | SHA-256 over canonical action, company and intent; UUID proof id | No raw import document is stored in the proof | Five-minute, single-use, session- and company-bound proof; mutation and consume share a transaction |
| API rate-limit key | SHA-256 of request client IP | Address-derived limiter key | Used as the limiter key; application configuration controls the API request limit |
| View-as-member token | Web Crypto generates 32 random bytes, encoded as base64url | Random session-bound token stored with the active company/actor/target row | Removed when the projection ends; no Node `node:crypto` import |
| Account-command payload | SHA-256 over canonical operation, company and payload; random command/idempotency UUIDs | Payload hash and operation context | Replay/identity handles only; raw credentials are not stored as command results |
| Import impact fingerprint | SHA-256 of canonical full export rows | Current company data fingerprint | Compares previewed content with current rows; stale-preview rejection separately compares the planning revision and requires a new preview |
| Record identifiers | CSPRNG UUIDs | Identifier, not a secret | Used for users, restoration groups and account command/proof records |
| Encryption configuration | Adonis AES-256-GCM encryptor declaration | `APP_KEY` | The application configures the key, but this inventory does not establish which stored application data uses the encryptor; the session cookie flags are configured separately |
| Account Kit limiter | HMAC-keyed limiter with `APP_KEY` | `APP_KEY` | Keeps rate-limit keys scoped to the application secret |
| Internal service TLS | OpenSSL P-256/SHA-256, Node HTTPS and nginx verification | Per-install root-only CA key; API-only leaf key; public CA/leaf | automatic in Compose; optional for same-host bare metal; configured identities never fall back silently; coordinated renewal/recreation |
| Public TLS | TLS proxy and Node trust store | Public certificate and chain | Operator-managed certificate lifecycle |

Runtime `node:crypto` importers are accounted for here: `apps/backend/app/models/user.ts` creates
UUID identifiers; `account_commands.ts` creates command UUIDs and payload hashes;
`auth/action_proof.ts` creates proof UUIDs and intent hashes; `auth/request_limit.ts` hashes client
IP keys; `beta_account_transfer.ts` hashes import snapshots; and
`planning_operations/restoration.ts` creates restoration-group UUIDs. The browser uses Web Crypto
for UUIDs and a command digest. Build scripts use SHA-256 for file integrity; packaged-server smoke
tooling uses UUIDs. These are identifiers or integrity/limiter hashes, not password or bearer-token
storage.

The cryptographic inventory is reviewed by hand; no gate discovers implementation paths. Review it
after cryptographic changes. `APP_KEY` configures the application AES-256-GCM encryptor and Account Kit limiter secret; current application call sites for encrypted stored data are not established.
`CAPACITYLENS_SECRET` is checked for length at boot when authentication is enabled, but does not
derive application keys. Operators maintain their deployment key/certificate inventory, rotation
policy and backup-encryption controls.

## Service connection and work limits

| Service/resource | Maximum | Limit behavior and recovery |
| --- | ---: | --- |
| API accepted sockets | 512 per process | New sockets are refused; proxy surfaces upstream failure |
| API request/incomplete connection | 30 seconds for request reception and socket inactivity | These are HTTP receive/inactivity timeouts, not handler or database execution deadlines; clients and proxies should bound retries and upstream waits |
| SQLite | One synchronous connection per process and database file | Pool acquisition waits up to five seconds; SQLite lock waits up to one second before surfacing failure; these are separate limits, not an aggregate operation deadline; do not spawn another writer |
| Production API requests | 300 per minute per IP by default; operator may configure another bounded value | Production startup rejects invalid or zero values; unset configuration uses the 300/minute default; retain edge controls for deployment protection |
| Failed action-proof password checks | 3 per 10 seconds per IP | Action-proof controller consumes and resets this budget; sign-in has separate Account Kit throttles |
| Account Kit sign-in throttle | 10 requests/minute per client; 5/minute per identity with a 20-minute block | Defaults in the vendored Account Kit; application configuration changes only test throttling |
| Import preparation | Atomic database operation; framework request-size limit | Invalid imports fail without replacing stored data |
| Batch mutation | Framework parser limits | One SQLite transaction; authorization/validation per operation; a stale conflict rolls the batch back |
| Backup operation | One in flight | Scheduler skips overlap; shutdown waits before closing SQLite |

## Security and audit event inventory

| Layer | Events | Format/destination | Sensitive-data rule |
| --- | --- | --- | --- |
| API request log | Event, method, route, status, outcome and correlation ID when request logging is enabled; no latency is recorded | Pino JSON stdout | No request/response bodies, cookie or authorization values; sensitive bearer path segments are redacted |
| Application audit | Actor, company, action, entity, id and changed field names | Transactional SQLite `audit_entries` table | No entity values, passwords or bearer tokens |
| Authentication events | No auth-specific success, failure or throttling events are written to the application audit table | No application security event stream is configured; optional request logs record route/status metadata | Generic request telemetry is not a complete authentication event record; this open code gap is tracked in [issue #1629](https://github.com/Kevinjohn/capacitylens/issues/1629) |
| Proxy/platform | TLS/access/container/collector events | Deployment-defined systems | Operator classifies, redacts, restricts, retains and correlates in UTC |

Production configuration requires application audit to remain enabled. The application does not
provide a security-log stream or write authentication outcomes. The operator must document access,
retention, time synchronization, alerting and any external log collection.

## Third parties and build inputs

- Runtime includes Node.js 24, AdonisJS, Account Kit (vendored archive), React/UI packages, SQLite
  in Node and configured SMTP. Account Kit is pinned by lockfile integrity and is outside
  Dependabot's direct package release tracking.
- Build/test inputs include pnpm registry packages, GitHub Actions, CodeQL, Playwright browsers,
  Vitest, ESLint, Stryker, Gitleaks, Syft/Anchore, Trivy and OWASP ZAP.
- `pnpm-lock.yaml` pins the dependency graph. Reviewed overrides keep vulnerable transitive
  packages on compatible patched releases where needed. GitHub actions are full-commit pinned;
  Dependabot covers npm and Actions.
- pnpm lifecycle-script policy is fail closed; `allowBuilds` permits only reviewed install scripts.
- CI performs dependency review, production audit, secret scanning, CodeQL, SBOM generation,
  vulnerability scanning, DAST and release provenance. Published releases attach the packaged build,
  SPDX SBOM and GitHub-issued provenance bundle as release assets. The blocking DAST baseline scans
  the only supported posture, password sign-in, as the deployment guide configures it. The
  public-repository workflows run automatically on their documented events and remain manually
  runnable for deliberate reruns.
